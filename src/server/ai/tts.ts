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

export interface TTSOptions {
  /** ElevenLabs voice id (resolved from agent_versions.voice_map per language). */
  voiceId: string;
  /** Language code (used for the multilingual model — supports 32 languages). */
  language?: string;
  /** Output format — pcm_16000 keeps decoding ~free in the browser. */
  format?: 'pcm_16000' | 'mp3_44100_128';
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

    const format = this.opts.format ?? 'pcm_16000';
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
