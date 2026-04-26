/**
 * Deepgram Nova-3 streaming STT.
 *
 * Opens a WebSocket to Deepgram, accepts raw 16-bit PCM @ 16 kHz, and emits:
 *   • { type: 'partial', text }     — interim transcripts (~every 100ms)
 *   • { type: 'final', text, lang } — final transcript + detected language
 *   • { type: 'speech_started' }    — for barge-in
 *   • { type: 'utterance_end' }     — Deepgram's end-of-speech signal
 *   • { type: 'error', error }
 *
 * Usage:
 *   const stt = new DeepgramStream({ language: 'multi', detectLanguage: true });
 *   await stt.open();
 *   stt.on('event', (e) => ...);
 *   stt.send(pcmFrame);
 *   await stt.close();
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export interface STTOptions {
  /** Deepgram language code, or 'multi' for autodetect across enabled languages. */
  language: string;
  /** When true and language is 'multi', the response includes per-utterance language. */
  detectLanguage?: boolean;
  /** Sample rate of the input audio (we always use 16000). */
  sampleRate?: number;
}

export type STTEvent =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string; language?: string }
  | { type: 'speech_started' }
  | { type: 'utterance_end' }
  | { type: 'error'; error: string };

export declare interface DeepgramStream {
  on(event: 'event', listener: (e: STTEvent) => void): this;
  on(event: 'close', listener: () => void): this;
}

export class DeepgramStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private opened: Promise<void> | null = null;

  constructor(private opts: STTOptions) {
    super();
  }

  open(): Promise<void> {
    if (this.opened) return this.opened;
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) return Promise.reject(new Error('DEEPGRAM_API_KEY not set'));

    // Deepgram Nova-3 streaming. With language=multi, auto-detection is implicit —
    // the legacy `detect_language` flag is for non-multi modes only and confuses the
    // edge into hanging when combined with `language=multi`.
    const params = new URLSearchParams({
      model: 'nova-3',
      encoding: 'linear16',
      sample_rate: String(this.opts.sampleRate ?? 16000),
      channels: '1',
      interim_results: 'true',
      vad_events: 'true',
      // 700 ms gives natural mid-sentence pause room (was 300 — too aggressive,
      // clipped users mid-thought). 1200 ms utterance-end matches typical
      // breath/thought boundaries for conversational speech.
      endpointing: '700',
      utterance_end_ms: '1200',
      smart_format: 'true',
      language: this.opts.language,
    });

    const url = `wss://api.deepgram.com/v1/listen?${params}`;
    this.ws = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });

    this.opened = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const err = new Error('Deepgram open timeout (6s)');
        this.emit('event', { type: 'error', error: err.message });
        try {
          this.ws?.close();
        } catch {}
        reject(err);
      }, 6000);
      this.ws!.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.ws!.once('error', (err) => {
        clearTimeout(timeout);
        this.emit('event', { type: 'error', error: String(err) });
        reject(err);
      });
      this.ws!.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (c) => {
          body += c.toString();
        });
        res.on('end', () => {
          console.warn('[deepgram] unexpected-response', res.statusCode, body);
        });
      });
      this.ws!.on('message', (raw) => this.handleMessage(raw.toString()));
      this.ws!.on('close', () => this.emit('close'));
    });
    return this.opened;
  }

  send(audio: Buffer | Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(audio);
  }

  async close(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Send a CloseStream message so Deepgram flushes any pending transcript.
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      await new Promise<void>((r) => {
        const t = setTimeout(r, 500);
        this.ws!.once('close', () => {
          clearTimeout(t);
          r();
        });
      });
    }
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'Results': {
        const alt = msg.channel?.alternatives?.[0];
        if (!alt) return;
        const text: string = alt.transcript ?? '';
        const lang = msg.channel?.detected_language ?? undefined;

        // Buffer transcript across is_final segments — Deepgram fires is_final
        // at every segment boundary, NOT at end-of-utterance. We need to wait
        // for either `speech_final` (endpointed) or a separate `UtteranceEnd`
        // event before treating the turn as done.
        if (msg.is_final) {
          if (text) this.transcriptBuf += (this.transcriptBuf ? ' ' : '') + text;
          if (lang) this.lastLang = lang;
          if (msg.speech_final) {
            this.emitFinal();
          }
        } else if (text) {
          this.emit('event', { type: 'partial', text: this.transcriptBuf
            ? `${this.transcriptBuf} ${text}` : text });
        }
        break;
      }
      case 'SpeechStarted':
        this.emit('event', { type: 'speech_started' });
        break;
      case 'UtteranceEnd':
        // Authoritative end-of-turn signal. Flush whatever we've accumulated.
        this.emitFinal();
        this.emit('event', { type: 'utterance_end' });
        break;
      case 'Error':
        this.emit('event', { type: 'error', error: msg.message ?? 'Deepgram error' });
        break;
    }
  }

  private transcriptBuf = '';
  private lastLang: string | undefined;
  private emitFinal() {
    const text = this.transcriptBuf.trim();
    this.transcriptBuf = '';
    if (!text) return;
    this.emit('event', { type: 'final', text, language: this.lastLang });
    this.lastLang = undefined;
  }
}
