/* global registerProcessor, sampleRate */
/**
 * PCM-16 worklet: captures microphone audio at the AudioContext's native rate,
 * downsamples to 16 kHz mono, converts Float32 → Int16, and posts each ~20 ms
 * frame back to the main thread for transmission to the server.
 *
 * Loaded by AudioContext.audioWorklet.addModule('/audio/pcm-worklet.js').
 */

const TARGET_RATE = 16000;
const FRAME_SAMPLES_AT_TARGET = 320; // 20 ms @ 16kHz

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.outBuf = new Int16Array(FRAME_SAMPLES_AT_TARGET);
    this.outIdx = 0;
    this.acc = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    // Linear-interpolation downsampler. ratio is typically 48000/16000 = 3.
    let i = 0;
    while (i < ch.length) {
      let step = Math.floor(this.acc + this.ratio);
      if (step < 1) step = 1; // Prevent infinite loop if sampleRate < 16000
      const next = i + step;
      // Average from i..next for smoother downsample than nearest-neighbor.
      const end = Math.min(next, ch.length);
      let sum = 0;
      let count = 0;
      for (let k = i; k < end; k++) {
        sum += ch[k];
        count++;
      }
      const sample = count ? sum / count : 0;
      // Float32 [-1,1] → Int16
      const s = Math.max(-1, Math.min(1, sample));
      this.outBuf[this.outIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.outIdx >= FRAME_SAMPLES_AT_TARGET) {
        this.port.postMessage(this.outBuf.buffer.slice(0));
        this.outIdx = 0;
      }
      i = next;
      this.acc = (this.acc + this.ratio) - step;
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
