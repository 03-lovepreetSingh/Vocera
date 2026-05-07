/**
 * ElevenLabs Flash v2.5 streaming TTS over WebSocket.
 *
 * Why WebSocket: text is sent incrementally (sentence-by-sentence as the LLM
 * produces them), and audio chunks come back the moment the model has produced
 * a few hundred milliseconds. Total TTFA (time-to-first-audio) stays ~75 ms
 * even mid-response.
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

/**
 * Cache of voices actually available to this ElevenLabs account. Populated on
 * first use by hitting GET /v1/voices. Hard-coded voice ids (e.g. Rachel) only
 * work if they're in the user's library; new free-tier accounts have a much
 * smaller default set than the public catalog suggests, and synthesizing
 * against an unknown id silently produces zero audio.
 */
let _availableVoiceIds: Set<string> | null = null;
let _availableVoiceIdList: string[] = [];
let _voicesPromise: Promise<void> | null = null;

async function loadAvailableVoices(): Promise<void> {
  if (_availableVoiceIds) return;
  if (_voicesPromise) return _voicesPromise;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');
  _voicesPromise = (async () => {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ElevenLabs /voices ${res.status}: ${body}`);
    }
    const json = (await res.json()) as { voices: { voice_id: string; name: string }[] };
    _availableVoiceIdList = json.voices.map((v) => v.voice_id);
    _availableVoiceIds = new Set(_availableVoiceIdList);
    console.log(
      '[elevenlabs] available voices in account:',
      json.voices.map((v) => `${v.name}(${v.voice_id.slice(0, 6)})`).join(', '),
    );
  })().catch((err) => {
    // If the discovery call rejects (free-tier missing voices_read scope is
    // typical), reset so subsequent sessions can retry — without this, every
    // future session inherits a permanently rejected promise.
    _voicesPromise = null;
    throw err;
  });
  return _voicesPromise;
}

/**
 * Resolve a usable voice id given a preferred one. Falls back to the first
 * voice in the user's library if the preferred id isn't accessible.
 */
export async function resolveVoiceId(preferred: string): Promise<string | null> {
  await loadAvailableVoices().catch((err) => {
    console.warn('[elevenlabs] failed to load voices, will try preferred id anyway:', err);
  });
  if (!_availableVoiceIds) return preferred || null;
  if (_availableVoiceIds.has(preferred)) return preferred;
  const fallback = _availableVoiceIdList[0] ?? null;
  if (fallback) {
    console.warn(
      `[elevenlabs] preferred voice ${preferred} not in account; falling back to ${fallback}`,
    );
  }
  return fallback;
}

export interface TTSOptions {
  /** ElevenLabs voice id (resolved from agent_versions.voice_map per language). */
  voiceId: string;
  /** Language code (used for the multilingual model — supports 32 languages). */
  language?: string;
  /**
   * Output format. Default `mp3_44100_128` — works on every ElevenLabs tier
   * including free. `pcm_16000` and `ulaw_8000` are paid-tier only and
   * silently produce zero audio on free, which is the trap we're avoiding.
   * `mp3_22050_32` is free-tier-compatible MP3 used by the Twilio path
   * (transcoded to μ-law downstream).
   */
  format?: 'pcm_16000' | 'mp3_44100_128' | 'mp3_22050_32' | 'ulaw_8000';
}

export type TTSEvent =
  | { type: 'audio'; data: Buffer }
  | { type: 'final' }
  | { type: 'error'; error: string };

export declare interface ElevenLabsStream {
  on(event: 'event', listener: (e: TTSEvent) => void): this;
}

export class ElevenLabsStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private opened: Promise<void> | null = null;

  constructor(private opts: TTSOptions) {
    super();
  }

  open(): Promise<void> {
    if (this.opened) return this.opened;
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return Promise.reject(new Error('ELEVENLABS_API_KEY not set'));

    const format = this.opts.format ?? 'mp3_44100_128';
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${this.opts.voiceId}/stream-input` +
      `?model_id=eleven_flash_v2_5&output_format=${format}&optimize_streaming_latency=4`;

    this.ws = new WebSocket(url, { headers: { 'xi-api-key': apiKey } });

    this.opened = new Promise((resolve, reject) => {
      this.ws!.once('open', () => {
        // Initial config message.
        this.ws!.send(
          JSON.stringify({
            text: ' ',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            generation_config: { chunk_length_schedule: [50, 90, 120, 150] },
            xi_api_key: apiKey,
          }),
        );
        resolve();
      });
      this.ws!.once('error', (err) => {
        this.emit('event', { type: 'error', error: String(err) });
        reject(err);
      });
      this.ws!.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (c) => {
          body += c.toString();
        });
        res.on('end', () => {
          console.warn('[elevenlabs] unexpected-response', res.statusCode, body);
        });
      });
      this.ws!.on('message', (raw) => this.handleMessage(raw.toString()));
      this.ws!.on('close', () => this.emit('event', { type: 'final' }));
    });
    return this.opened;
  }

  /** Send a sentence (or partial text) for synthesis. Always end with a space. */
  speak(text: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ text: text.endsWith(' ') ? text : `${text} `, try_trigger_generation: true }));
  }

  /** Tell ElevenLabs we're done — flushes the buffer and closes naturally. */
  flush(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ text: '' }));
  }

  /** Hard cancel — used for barge-in. */
  abort(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.close();
    this.ws = null;
    this.opened = null;
  }

  private handleMessage(raw: string) {
    let msg: { audio?: string; isFinal?: boolean; error?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.audio) {
      this.emit('event', { type: 'audio', data: Buffer.from(msg.audio, 'base64') });
    }
    if (msg.error) this.emit('event', { type: 'error', error: msg.error });
    if (msg.isFinal) this.emit('event', { type: 'final' });
  }
}
