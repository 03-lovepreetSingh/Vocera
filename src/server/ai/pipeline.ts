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
import { ElevenLabsStream } from './tts';
import { queryTopK } from '@/server/rag/pinecone';
import { getLanguage } from '@/lib/languages';

export interface AgentContext {
  agentId: number;
  agentExternalId: string;
  workspaceExternalId: string;
  systemPrompt: string;
  languages: string[];
  defaultLanguage: string;
  voiceMap: Record<string, string>;
}

export interface PipelineCallbacks {
  /** Audio chunks (PCM 16kHz) ready to ship to the browser. */
  onAudio: (data: Buffer) => void;
  /** A new agent text token — useful for live transcript display. */
  onAgentText: (delta: string) => void;
  /** STT partial. */
  onUserPartial: (text: string) => void;
  /** STT final + detected language. */
  onUserFinal: (text: string, language?: string) => void;
  /** Tell the browser to drop any queued audio (used on barge-in). */
  onClear: () => void;
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

  constructor(
    private agent: AgentContext,
    private cb: PipelineCallbacks,
  ) {
    this.namespace = `${agent.workspaceExternalId}__${agent.agentExternalId}`;
  }

  /** Called when STT emits a final transcript. Drives one full turn. */
  async onUserUtterance(text: string, detectedLanguage?: string) {
    if (!text.trim()) return;

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

    const voiceId = this.agent.voiceMap[lang] ?? getLanguage(lang)?.elevenVoiceId ?? '';
    if (!voiceId) {
      this.cb.onAgentText("(no voice configured for this language)");
      return;
    }

    // Pre-open TTS WS while LLM is warming up. Saves ~150 ms on cold turns.
    const tts = new ElevenLabsStream({ voiceId, language: lang });
    this.currentTts = tts;
    this.speaking = true;
    const ttsOpen = tts.open();
    tts.on('event', (e) => {
      if (e.type === 'audio') this.cb.onAudio(e.data);
    });

    const sentenceBuf = new SentenceBuffer();
    let fullText = '';
    let firstTokenAt = 0;

    try {
      const stream = streamCompletion({
        systemPrompt: this.agent.systemPrompt,
        history: messagesWithRetrieval,
        signal: abort.signal,
      });

      for await (const chunk of stream) {
        if (abort.signal.aborted) break;
        if (chunk.delta) {
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
    } catch (err) {
      if (!abort.signal.aborted) console.error('[pipeline] LLM error', err);
      tts.abort();
    }

    if (fullText.trim()) this.history.push({ role: 'assistant', content: fullText.trim() });
    this.speaking = false;
    if (this.currentTurnAbort === abort) this.currentTurnAbort = null;
    if (this.currentTts === tts) this.currentTts = null;
  }

  /** Called when STT detects user speech mid-response. */
  onSpeechStarted() {
    if (this.speaking) {
      this.cancelInFlight();
      this.cb.onClear();
    }
  }

  private cancelInFlight() {
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
