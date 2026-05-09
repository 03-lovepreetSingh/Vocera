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

  // Half-duplex gating. While TTS is producing sound (HTMLAudio or
  // SpeechSynthesis), drop mic frames before they reach the WS — otherwise the
  // agent's own voice leaks back through the speakers, gets captured by the
  // mic, and Deepgram transcribes it as the user. `muteMicUntil` adds a tail
  // window after TTS ends to absorb room reverb / late audio buffer flush.
  private ttsPlaying = false;
  private muteMicUntil = 0;
  private static readonly MIC_TAIL_MS = 350;

  constructor(private opts: VoiceClientOptions) {}

  private isMicMuted(): boolean {
    return this.ttsPlaying || Date.now() < this.muteMicUntil;
  }

  // Diagnostic: emits one line per second describing the mic-gate state, frame
  // counts, AND peak amplitude since last tick. Distinguishes "frames flowing
  // but silent" (OS mic muted, AudioContext suspended) from "frames flowing
  // with audio" (Deepgram-side issue) from "no frames" (worklet dead).
  private framesSentSinceTick = 0;
  private framesDroppedSinceTick = 0;
  private maxAmplitudeSinceTick = 0;
  private diagTickerStarted = false;
  private startDiagTicker() {
    if (this.diagTickerStarted) return;
    this.diagTickerStarted = true;
    setInterval(() => {
      const sent = this.framesSentSinceTick;
      const dropped = this.framesDroppedSinceTick;
      const peak = this.maxAmplitudeSinceTick;
      this.framesSentSinceTick = 0;
      this.framesDroppedSinceTick = 0;
      this.maxAmplitudeSinceTick = 0;
      if (sent === 0 && dropped === 0) return;
      const ctxState = this.ctx?.state ?? 'no-ctx';
      const trackState = this.mediaStream?.getAudioTracks()[0]?.readyState ?? 'no-track';
      const trackEnabled = this.mediaStream?.getAudioTracks()[0]?.enabled ?? false;
      // Peak / 32768 is the normalised PCM-16 sample amplitude (0..1).
      const peakNorm = peak / 32768;
      const audioState =
        peakNorm < 0.01 ? 'SILENT' : peakNorm < 0.05 ? 'quiet' : 'audible';
      console.log(
        '[VoiceClient.diag] mic ttsPlaying=', this.ttsPlaying,
        'muteMs=', Math.max(0, this.muteMicUntil - Date.now()),
        'sent=', sent,
        'dropped=', dropped,
        'peak=', peakNorm.toFixed(3),
        'audio=', audioState,
        'ctx=', ctxState,
        'track=', trackState,
        'enabled=', trackEnabled,
      );
    }, 1000);
  }

  /** Compute peak |sample| across an Int16 PCM frame for diagnostic amplitude tracking. */
  private trackFrameAmplitude(buf: ArrayBuffer) {
    const view = new Int16Array(buf);
    let peak = 0;
    // Stride-sample to keep this cheap; 1 in 8 samples is enough for peak detection.
    for (let i = 0; i < view.length; i += 8) {
      const v = view[i] < 0 ? -view[i] : view[i];
      if (v > peak) peak = v;
    }
    if (peak > this.maxAmplitudeSinceTick) this.maxAmplitudeSinceTick = peak;
  }

  private setTtsPlaying(playing: boolean) {
    this.ttsPlaying = playing;
    if (!playing) {
      this.muteMicUntil = Date.now() + VoiceClient.MIC_TAIL_MS;
    }
  }

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
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        // Half-duplex: drop frames while the agent is talking (and for a brief
        // tail after) so the speaker→mic path can't echo into Deepgram.
        if (this.isMicMuted()) {
          this.framesDroppedSinceTick++;
          return;
        }
        this.framesSentSinceTick++;
        this.ws.send(ev.data);
      };
      this.startDiagTicker();
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
          this.setTtsPlaying(false);
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
    const release = () => {
      URL.revokeObjectURL(url);
      if (this.currentAudioEl === audio) this.currentAudioEl = null;
      this.setTtsPlaying(false);
    };
    audio.addEventListener('play', () => this.setTtsPlaying(true));
    audio.addEventListener('ended', release);
    audio.addEventListener('pause', () => {
      // Pause without ended (e.g., barge-in clear) — same gating cleanup.
      if (audio.currentTime < audio.duration) release();
    });
    audio.addEventListener('error', release);
    this.currentAudioEl = audio;
    audio.play().catch((err) => {
      console.warn('audio playback blocked', err);
      release();
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
        u.onstart = () => {
          this.setTtsPlaying(true);
          console.log('[VoiceClient] tts started:', text.slice(0, 60));
        };
        u.onerror = (e) => {
          this.setTtsPlaying(false);
          console.warn('[VoiceClient] tts error', e);
        };
        u.onend = () => {
          this.setTtsPlaying(false);
          console.log('[VoiceClient] tts ended');
        };
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
