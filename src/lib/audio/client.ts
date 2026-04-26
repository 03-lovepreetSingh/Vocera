/**
 * Browser-side voice client.
 *
 * Flow on `start()`:
 *   1. Mint a session token via the REST API.
 *   2. Open the WebSocket and wait for the server to greet ({type:'ready'}).
 *   3. Begin mic capture only after we've heard the greeting — that way the
 *      worklet/postMessage flood can't freeze the UI before the user hears
 *      anything, and the greeting is decoupled from getUserMedia entirely.
 *
 * Audio playback paths:
 *   - {type:'speak_text'}  → window.speechSynthesis (free, on-device)
 *   - binary MP3 chunks    → buffered, played as a Blob on {type:'audio_done'}
 */

/**
 * Pick the best installed SpeechSynthesisVoice for the target BCP-47 lang.
 * Without this, Chromium picks the system default (en-US) regardless of the
 * `utterance.lang` we set, which mangles non-Latin scripts.
 */
function pickBestVoice(
  voices: SpeechSynthesisVoice[],
  target: string,
): SpeechSynthesisVoice | undefined {
  if (!voices.length) return undefined;
  const t = target.toLowerCase();
  const tBase = t.split('-')[0];
  return (
    voices.find((v) => v.lang.toLowerCase() === t) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(`${tBase}-`)) ??
    voices.find((v) => v.lang.toLowerCase() === tBase)
  );
}

export type VoiceClientEvent =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string; language?: string }
  | { type: 'agent_text'; delta: string }
  | { type: 'metrics'; ttftMs: number }
  | { type: 'error'; error: string }
  | { type: 'closed' };

export interface VoiceClientOptions {
  agentExternalId: string;
  onEvent: (e: VoiceClientEvent) => void;
}

export class VoiceClient {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private worklet: AudioWorkletNode | null = null;
  private pendingAudioChunks: ArrayBuffer[] = [];
  private currentAudioEl: HTMLAudioElement | null = null;
  private micStartScheduled = false;

  constructor(private opts: VoiceClientOptions) {}

  async start() {
    // 1. Mint a session token.
    const sessRes = await fetch(`/api/v1/agents/${this.opts.agentExternalId}/voice-session`, {
      method: 'POST',
    });
    if (!sessRes.ok) throw new Error('Failed to mint voice session');
    const { token } = (await sessRes.json()) as { token: string };

    // 2. Open WS. The voice WS server runs in its own Node process on a
    // dedicated port (default 3001) — see ws-server.ts. Override at build
    // time via NEXT_PUBLIC_WS_URL if you've put it behind a reverse proxy.
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base =
      process.env.NEXT_PUBLIC_WS_URL ??
      `${protocol}//${location.hostname}:${process.env.NEXT_PUBLIC_WS_PORT ?? '3001'}`;
    const wsUrl = `${base}/voice/${token}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = () => this.opts.onEvent({ type: 'closed' });
    ws.onerror = () => this.opts.onEvent({ type: 'error', error: 'websocket error' });
    await this.waitForOpen(ws);
    console.log('[VoiceClient] ws open');
  }

  private waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) return resolve();
      const onOpen = () => {
        ws.removeEventListener('open', onOpen);
        resolve();
      };
      const onErr = () => {
        ws.removeEventListener('error', onErr);
        reject(new Error('ws failed to open'));
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onErr);
    });
  }

  /**
   * Start mic capture + worklet. Called after the greeting plays. Failures
   * are non-fatal — the greeting still worked and the user knows the agent
   * is alive; we just can't capture their voice yet.
   */
  private async startMicCapture(): Promise<void> {
    if (this.micStartScheduled) return;
    this.micStartScheduled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      this.mediaStream = stream;

      const ctx = new AudioContext();
      this.ctx = ctx;
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {}
      }
      await ctx.audioWorklet.addModule('/audio/pcm-worklet.js');

      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'pcm-worklet');
      node.port.onmessage = (ev) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(ev.data);
      };
      src.connect(node);
      // CRITICAL: route the worklet output to a muted gain → destination.
      // Without a live downstream consumer, Chromium throttles the worklet's
      // process() loop and PCM frames never leave the worklet — the agent
      // would hear silence forever. Mute the gain so we don't echo the mic
      // back through the speakers.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute);
      mute.connect(ctx.destination);
      this.worklet = node;
      console.log('[VoiceClient] mic capture started, ctx.state=', ctx.state);
    } catch (err) {
      console.warn('[VoiceClient] mic capture failed', err);
      this.opts.onEvent({ type: 'error', error: 'mic permission denied or failed' });
    }
  }

  private async handleMessage(data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      console.log('[VoiceClient] msg <-', data.slice(0, 200));
      try {
        const msg = JSON.parse(data) as
          | VoiceClientEvent
          | { type: 'clear' }
          | { type: 'audio_done' }
          | { type: 'ready' }
          | { type: 'speak_text'; text: string; lang: string };
        const t = (msg as { type: string }).type;
        if (t === 'clear') {
          this.pendingAudioChunks = [];
          if (this.currentAudioEl && !this.currentAudioEl.paused) {
            try {
              this.currentAudioEl.pause();
            } catch {}
          }
          this.currentAudioEl = null;
          // Only cancel speechSynthesis if it's actually doing something.
          // Calling cancel() on an idle synth on Chromium leaves it in a
          // stuck state that silently drops the next speak() call —
          // that's what was killing turn 2's audio.
          try {
            const synth = window.speechSynthesis;
            if (synth && (synth.speaking || synth.pending)) synth.cancel();
          } catch {}
          return;
        }
        if (t === 'audio_done') {
          this.flushAudio();
          return;
        }
        if (t === 'speak_text') {
          this.speakViaBrowser(
            (msg as { text: string }).text,
            (msg as { lang: string }).lang,
          );
          // Greeting fired — now safe to start mic capture in the background.
          // setTimeout 0 yields to the event loop so React can render first.
          setTimeout(() => this.startMicCapture(), 0);
          return;
        }
        if (t === 'ready') {
          // STT is up; mic capture will start after greet (speak_text) arrives.
          return;
        }
        this.opts.onEvent(msg as VoiceClientEvent);
      } catch {
        /* ignore */
      }
      return;
    }
    // Binary: MP3 chunk — accumulate; play once `audio_done` arrives.
    this.pendingAudioChunks.push(data);
  }

  private flushAudio() {
    if (this.pendingAudioChunks.length === 0) return;
    const blob = new Blob(this.pendingAudioChunks, { type: 'audio/mpeg' });
    this.pendingAudioChunks = [];
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
      if (this.currentAudioEl === audio) this.currentAudioEl = null;
    });
    this.currentAudioEl = audio;
    audio.play().catch((err) => {
      console.warn('audio playback blocked', err);
    });
  }

  private speakViaBrowser(text: string, lang: string) {

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('[VoiceClient] speechSynthesis not available');
      return;
    }
    let spoken = false;
    const speak = () => {
      if (spoken) return; // Idempotent — voiceschanged + setTimeout both call this.
      spoken = true;
      try {
        const synth = window.speechSynthesis;
        try {
          synth.resume();
        } catch {}
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        // Pick the best installed voice for this lang. Without this, Chromium
        // defaults to en-US even when u.lang is hi-IN, mangling Devanagari.
        const voice = pickBestVoice(synth.getVoices(), lang);
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        }
        u.rate = 1.0;
        u.pitch = 1.0;
        u.onstart = () => console.log('[VoiceClient] tts started:', text.slice(0, 60));
        u.onerror = (e) => console.warn('[VoiceClient] tts error', e);
        u.onend = () => console.log('[VoiceClient] tts ended');
        synth.speak(u);
        console.log(
          '[VoiceClient] queued tts utterance, lang=',
          u.lang,
          'voice=',
          voice?.name ?? '(default)',
        );
      } catch (err) {
        console.warn('speechSynthesis threw', err);
      }
    };
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
      window.speechSynthesis.addEventListener('voiceschanged', speak, { once: true });
      setTimeout(speak, 500);
    } else {
      speak();
    }
  }

  stop() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'bye' }));
      } catch {}
    }
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    try {
      this.worklet?.disconnect();
    } catch {}
    this.worklet = null;
    try {
      this.mediaStream?.getTracks().forEach((t) => t.stop());
    } catch {}
    this.mediaStream = null;
    try {
      void this.ctx?.close();
    } catch {}
    this.ctx = null;
    try {
      this.currentAudioEl?.pause();
    } catch {}
    this.currentAudioEl = null;
    this.pendingAudioChunks = [];
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch {}
  }
}
