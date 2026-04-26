/**
 * Browser-side voice client. Owns:
 *   • mic capture via AudioWorklet (16 kHz PCM frames, ~20 ms each)
 *   • a WebSocket to /ws/voice/:token
 *   • playback of incoming PCM-16 audio chunks via AudioBufferSourceNode
 *
 * Designed for low latency: the moment a binary frame arrives we decode and
 * schedule it; the WS is opened before mic permission is granted to overlap
 * the cold-handshake with the user clicking "allow microphone".
 */

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
  private playheadTime = 0;

  constructor(private opts: VoiceClientOptions) {}

  async start() {
    // 1. Mint a session token (auth happens server-side over the cookie).
    const sessRes = await fetch(`/api/v1/agents/${this.opts.agentExternalId}/voice-session`, {
      method: 'POST',
    });
    if (!sessRes.ok) throw new Error('Failed to mint voice session');
    const { token } = (await sessRes.json()) as { token: string };

    // 2. Open WS in parallel with requesting the mic.
    const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/voice/${token}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = () => this.opts.onEvent({ type: 'closed' });
    ws.onerror = () => this.opts.onEvent({ type: 'error', error: 'websocket error' });

    // 3. Mic + AudioWorklet.
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
    await ctx.audioWorklet.addModule('/audio/pcm-worklet.js');

    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-worklet');
    node.port.onmessage = (ev) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(ev.data);
    };
    src.connect(node);
    // Worklet doesn't need to feed the destination; suppress feedback.
    this.worklet = node;
  }

  private async handleMessage(data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data) as VoiceClientEvent | { type: 'clear' };
        if ((msg as { type: string }).type === 'clear') {
          // Reset playhead — drop any queued audio.
          if (this.ctx) this.playheadTime = this.ctx.currentTime;
          return;
        }
        this.opts.onEvent(msg as VoiceClientEvent);
      } catch {
        /* ignore */
      }
      return;
    }
    // Binary: PCM 16kHz mono — schedule playback.
    if (!this.ctx) return;
    const pcm = new Int16Array(data);
    const buf = this.ctx.createBuffer(1, pcm.length, 16000);
    const f = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 0x8000;

    const node = this.ctx.createBufferSource();
    node.buffer = buf;
    node.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    const start = Math.max(this.playheadTime, now);
    node.start(start);
    this.playheadTime = start + buf.duration;
  }

  stop() {
    try {
      this.ws?.send(JSON.stringify({ type: 'bye' }));
    } catch {
      /* ignore */
    }
    this.ws?.close();
    this.ws = null;
    this.worklet?.disconnect();
    this.worklet = null;
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
