/**
 * Sentence buffer for sentence-level TTS handoff.
 *
 * The LLM streams tokens; we forward them to TTS only when we have a coherent
 * speakable unit. Splits on `. ! ? ; \n`, plus on `,` after >5 words to keep
 * latency low when the model goes off on a long subordinate clause.
 */
export class SentenceBuffer {
  private buf = '';

  /** Push more LLM text. Returns any sentences ready to speak. */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];

    while (true) {
      const cut = this.findCut(this.buf);
      if (cut < 0) break;
      const sentence = this.buf.slice(0, cut + 1).trim();
      this.buf = this.buf.slice(cut + 1);
      if (sentence) out.push(sentence);
    }
    return out;
  }

  /** Drain any remaining text — call when LLM stream ends. */
  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = '';
    return rest || null;
  }

  private findCut(s: string): number {
    // Hard sentence terminators come first.
    const hard = s.search(/[.!?;\n]/);
    if (hard >= 0) return hard;
    // Soft cut: a comma after at least 5 words gets us speaking sooner.
    const comma = s.indexOf(',');
    if (comma >= 0) {
      const before = s.slice(0, comma);
      if (before.split(/\s+/).filter(Boolean).length >= 5) return comma;
    }
    // No cut yet but emit anyway if buffer gets long.
    if (s.length > 200) {
      const sp = s.lastIndexOf(' ', 200);
      return sp > 0 ? sp : 200;
    }
    return -1;
  }
}
