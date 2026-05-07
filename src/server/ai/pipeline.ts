/**
 * The canonical voice loop.
 *
 * Listens to STT events, drives the LLM with retrieved context, and feeds TTS
 * sentence-by-sentence. Owns the per-call mutable state (history, language,
 * speaking flag) and exposes the bare minimum to the WS handler.
 *
 * Latency-critical: every stage streams. Speculative retrieval + sentence
 * handoff + barge-in are all wired up here.
 */
import { embed } from './embed';
import { type ChatMessage, streamCompletion } from './llm';
import { SentenceBuffer } from './sentence-buffer';
import { ElevenLabsStream, resolveVoiceId, type TTSOptions } from './tts';
import { queryTopK } from '@/server/rag/pinecone';
import { detectLanguageFromText, getLanguage, greetingFor } from '@/lib/languages';

export interface AgentContext {
  agentId: number;
  agentExternalId: string;
  workspaceExternalId: string;
  systemPrompt: string;
  languages: string[];
  defaultLanguage: string;
  voiceMap: Record<string, string>;
  /**
   * Optional ElevenLabs output format override. Telco (Twilio) callers set this
   * to `'mp3_22050_32'` so we receive a smaller MP3 we can transcode to μ-law
   * 8 kHz in real time. Browser callers leave it undefined and inherit the
   * `mp3_44100_128` default.
   */
  ttsFormat?: TTSOptions['format'];
}

export interface PipelineCallbacks {
  /** Audio chunks (MP3 by default — see TTSOptions.format) for the browser. */
  onAudio: (data: Buffer) => void;
  /** A new agent text token — useful for live transcript display. */
  onAgentText: (delta: string) => void;
  /** STT partial. */
  onUserPartial: (text: string) => void;
  /** STT final + detected language. */
  onUserFinal: (text: string, language?: string) => void;
  /** Tell the browser to drop any queued audio (used on barge-in). */
  onClear: () => void;
  /** TTS finished sending audio for the current turn — browser can play. */
  onAudioDone: () => void;
  /**
   * Ask the browser to speak `text` via its built-in SpeechSynthesis API.
   * Used when ElevenLabs isn't available (free tier limits, errors, etc).
   * Free, multilingual, no server cost.
   */
  onSpeakText: (text: string, lang: string) => void;
  /** Per-turn telemetry — TTFT (end-of-utterance → first agent token). */
  onMetrics: (m: { ttftMs: number; turnIndex: number }) => void;
}

export class VoicePipeline {
  private history: ChatMessage[] = [];
  private turnIndex = 0;
  private speaking = false;
  private currentTurnAbort: AbortController | null = null;
  private currentTts: ElevenLabsStream | null = null;
  private namespace: string;
  /** All scheduled timers we own — cleared by cancelInFlight()/teardown(). */
  private timers = new Set<NodeJS.Timeout>();

  constructor(
    private agent: AgentContext,
    private cb: PipelineCallbacks,
  ) {
    this.namespace = `${agent.workspaceExternalId}__${agent.agentExternalId}`;
  }

  /**
   * Speak a localized greeting through TTS — fired the moment the voice loop
   * is ready, so the user hears the agent immediately and knows things work.
   * Bypasses the LLM (instant) and seeds history so subsequent turns are coherent.
   */
  async greet(): Promise<void> {
    const lang = this.agent.defaultLanguage;
    const text = greetingFor(lang);
    console.log('[greet] starting, lang=', lang, 'text=', text);
    // Greeting is short, fixed text — let the browser synthesize it locally
    // (free, instant, multilingual). Skips the ElevenLabs round-trip entirely.
    this.cb.onAgentText(text);
    this.cb.onSpeakText(text, lang);
    this.history.push({ role: 'assistant', content: text });
  }

  /** Called when STT emits a final transcript. Drives one full turn. */
  async onUserUtterance(text: string, detectedLanguage?: string) {
    if (!text.trim()) return;
    console.log('[pipeline] onUserUtterance:', JSON.stringify(text), 'detected=', detectedLanguage);

    // Pick language for response. If the user spoke an unsupported language,
    // bail to default language with a polite refusal — the system prompt
    // already instructs the LLM to handle this.
    const lang =
      detectedLanguage && this.agent.languages.includes(detectedLanguage)
        ? detectedLanguage
        : this.agent.defaultLanguage;

    this.history.push({ role: 'user', content: text });
    this.cb.onUserFinal(text, detectedLanguage);

    const turn = ++this.turnIndex;
    const startedAt = Date.now();

    // Cancel any in-flight turn (barge-in came in while we were still talking).
    this.cancelInFlight();

    const abort = new AbortController();
    this.currentTurnAbort = abort;

    // ─── parallel: retrieval + LLM start ───────────────────────
    const retrievalPromise = this.retrieve(text).catch(() => [] as string[]);

    // Kick off LLM — without retrieved chunks. We'll inject them via a system
    // message before the first token if retrieval is fast enough; otherwise
    // they'll be on the next turn (cheap LLM trick: greeting tokens are
    // generally KB-independent).
    const messagesWithRetrieval: ChatMessage[] = [...this.history];

    const ctxChunks = await Promise.race([
      retrievalPromise,
      new Promise<string[]>((r) => setTimeout(() => r([]), 250)),
    ]);
    if (ctxChunks.length) {
      messagesWithRetrieval.unshift({
        role: 'system',
        content: `<context>\n${ctxChunks.join('\n---\n')}\n</context>`,
      });
    }

    const preferredVoice = this.agent.voiceMap[lang] ?? getLanguage(lang)?.elevenVoiceId ?? '';
    const voiceId = await resolveVoiceId(preferredVoice);
    if (!voiceId) {
      this.cb.onAgentText('(no voice available in your ElevenLabs account)');
      return;
    }

    // Pre-open TTS WS in parallel with LLM streaming. We run the LLM and
    // accumulate the full reply; if ElevenLabs ever produces audio we use it,
    // otherwise we fall back to the browser's free SpeechSynthesis at the end.
    // NB: do NOT set speaking=true here — VAD residual from the user's just-
    // finalized utterance can trigger speech_started → cancelInFlight() →
    // self-abort of this very turn. We only enable barge-in detection AFTER
    // the first LLM token has actually streamed.
    let elProducedAudio = false;
    const tts = new ElevenLabsStream({ voiceId, language: lang, format: this.agent.ttsFormat });
    this.currentTts = tts;
    const ttsOpen = tts.open().catch((err) => {
      console.warn('[pipeline] ElevenLabs unavailable — will use browser TTS:', err);
    });
    tts.on('event', (e) => {
      if (e.type === 'audio') {
        if (!elProducedAudio) {
          // First audio chunk has left the building — agent is now audibly
          // speaking. Flip `speaking` on so any user audio frames Deepgram
          // sees from this point are treated as a potential barge-in. We
          // don't flip it on at turn-start because VAD residual from the
          // user's just-finalized utterance would self-abort the turn.
          this.speaking = true;
        }
        elProducedAudio = true;
        this.cb.onAudio(e.data);
      } else if (e.type === 'final') {
        this.speaking = false;
        this.cb.onAudioDone();
      } else if (e.type === 'error') {
        console.warn('[pipeline] ElevenLabs error:', e.error);
      }
    });

    const sentenceBuf = new SentenceBuffer();
    let fullText = '';
    let firstTokenAt = 0;

    try {
      console.log(
        '[pipeline] calling LLM, history length=',
        messagesWithRetrieval.length,
        'systemPrompt chars=',
        this.agent.systemPrompt.length,
      );
      const stream = streamCompletion({
        systemPrompt: this.agent.systemPrompt,
        history: messagesWithRetrieval,
        signal: abort.signal,
      });

      let chunkCount = 0;
      for await (const chunk of stream) {
        if (abort.signal.aborted) {
          console.log('[pipeline] aborted mid-stream after', chunkCount, 'chunks');
          break;
        }
        if (chunk.delta) {
          chunkCount++;
          if (chunkCount === 1) console.log('[pipeline] first LLM token after', Date.now() - startedAt, 'ms');
          if (!firstTokenAt) {
            firstTokenAt = Date.now();
            this.cb.onMetrics({ ttftMs: firstTokenAt - startedAt, turnIndex: turn });
          }
          fullText += chunk.delta;
          this.cb.onAgentText(chunk.delta);

          for (const sentence of sentenceBuf.push(chunk.delta)) {
            await ttsOpen;
            tts.speak(sentence);
          }
        }
      }
      const tail = sentenceBuf.flush();
      if (tail) {
        await ttsOpen;
        tts.speak(tail);
      }
      tts.flush();
      console.log('[pipeline] LLM stream done, total chunks=', chunkCount, 'fullText.length=', fullText.length);
    } catch (err) {
      if (!abort.signal.aborted) console.error('[pipeline] LLM error', err);
      tts.abort();
    } finally {
      // Always commit whatever the agent managed to say to history — even on
      // abort. Without this, a barge-in would leave history with a `user` turn
      // followed by another `user` turn, which confuses subsequent LLM calls.
      if (fullText.trim()) {
        this.history.push({ role: 'assistant', content: fullText.trim() });
      } else if (abort.signal.aborted) {
        // Aborted before any tokens — record a placeholder so the user's turn
        // doesn't double up with the next one in the LLM's view.
        this.history.push({ role: 'assistant', content: '(interrupted)' });
      }
      // Trim history to the last 30 turns (15 user + 15 assistant) to bound
      // token cost and keep latency stable on long sessions.
      if (this.history.length > 30) {
        this.history.splice(0, this.history.length - 30);
      }
      this.speaking = false;
      if (this.currentTurnAbort === abort) this.currentTurnAbort = null;
      if (this.currentTts === tts) this.currentTts = null;
    }

    // Browser-TTS fallback for free-tier ElevenLabs (which silently produces
    // no audio). Fires only if EL didn't return any chunks within 600 ms.
    // Tracked so teardown / barge-in can cancel it before it stomps on a new
    // turn.
    const fallbackTimer = setTimeout(() => {
      this.timers.delete(fallbackTimer);
      if (!elProducedAudio && fullText.trim() && !abort.signal.aborted) {
        // Detect the language of the AGENT'S REPLY text — the LLM code-
        // switches based on the system prompt, but `lang` here was set from
        // STT detection at turn start. If the reply is Devanagari but lang
        // is en-US, the browser butchers Hindi text with an English voice.
        const speakLang = detectLanguageFromText(fullText, lang);
        console.log(
          '[pipeline] no EL audio — falling back to browser TTS, speakLang=',
          speakLang,
          '(input lang=',
          lang,
          ')',
        );
        this.cb.onSpeakText(fullText.trim(), speakLang);
      }
    }, 600);
    this.timers.add(fallbackTimer);
  }

  /**
   * Seed the conversation history with an assistant turn. Used by the WS
   * handler to record the inline greeting, so the LLM "remembers" it on the
   * next user turn and doesn't greet again or sound confused.
   */
  seedAssistantTurn(text: string) {
    if (!text.trim()) return;
    this.history.push({ role: 'assistant', content: text.trim() });
  }

  /** Called when STT detects user speech mid-response. */
  onSpeechStarted() {
    if (this.speaking) {
      this.cancelInFlight();
      this.cb.onClear();
    }
  }

  /** True while audio is streaming to the browser — used by the WS handler to
   * drop inbound mic frames so the agent's own voice can't be re-transcribed. */
  isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Public wrapper around cancelInFlight for tear-down on WS close — without
   * this, dropping the browser mid-turn leaks the upstream LLM stream and the
   * ElevenLabs WS connection.
   */
  teardown() {
    this.cancelInFlight();
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private cancelInFlight() {
    this.clearTimers();
    this.currentTurnAbort?.abort();
    this.currentTurnAbort = null;
    this.currentTts?.abort();
    this.currentTts = null;
    this.speaking = false;
  }

  private async retrieve(query: string): Promise<string[]> {
    try {
      const [vec] = await embed([query], { inputType: 'query' });
      const matches = await queryTopK(this.namespace, vec, 5);
      return matches
        .filter((m) => m.score >= 0.55) // drop weak matches; LLM behaves better with no context than bad context
        .map((m) => m.text)
        .slice(0, 5);
    } catch (err) {
      console.warn('[pipeline] retrieval failed (continuing without):', err);
      return [];
    }
  }
}
