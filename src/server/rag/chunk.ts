/**
 * Recursive text splitter. Targets ~800 tokens (≈3200 chars) per chunk with
 * 100-token (~400-char) overlap. Tries paragraph → sentence → word boundaries
 * before falling back to a hard cut.
 *
 * No tokenizer in the loop — char-counting is "good enough" within ±10% of true
 * token counts for English/European text and avoids loading tiktoken in the hot path.
 */

const TARGET_CHARS = 3200;
const MIN_CHARS = 800;
const MAX_CHARS = 4800;
const OVERLAP_CHARS = 400;

const SEPARATORS: ReadonlyArray<RegExp> = [
  /\n\s*\n+/g, // paragraph
  /(?<=[.!?])\s+/g, // sentence
  /\s+/g, // word
];

export interface Chunk {
  index: number;
  text: string;
}

export function chunkText(text: string): Chunk[] {
  const cleaned = text.replace(/\r\n?/g, '\n').trim();
  if (!cleaned) return [];

  const segments = splitRecursive(cleaned, 0);
  // Pack segments into ~TARGET_CHARS chunks with overlap.
  const chunks: Chunk[] = [];
  let buf = '';
  let idx = 0;

  for (const seg of segments) {
    if (!seg) continue;
    if (buf.length + seg.length + 1 <= MAX_CHARS) {
      buf += (buf ? ' ' : '') + seg;
      if (buf.length >= TARGET_CHARS) {
        chunks.push({ index: idx++, text: buf.trim() });
        buf = tail(buf, OVERLAP_CHARS);
      }
    } else {
      if (buf) {
        chunks.push({ index: idx++, text: buf.trim() });
        buf = tail(buf, OVERLAP_CHARS);
      }
      // hard-cut overlong segment
      for (let i = 0; i < seg.length; i += MAX_CHARS - OVERLAP_CHARS) {
        chunks.push({ index: idx++, text: seg.slice(i, i + MAX_CHARS).trim() });
      }
      buf = tail(seg, OVERLAP_CHARS);
    }
  }
  if (buf.trim().length >= MIN_CHARS / 2) {
    chunks.push({ index: idx++, text: buf.trim() });
  }
  return chunks;
}

function splitRecursive(text: string, depth: number): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const sep = SEPARATORS[Math.min(depth, SEPARATORS.length - 1)];
  const parts = text.split(sep);
  if (parts.length === 1 || depth >= SEPARATORS.length - 1) return parts;
  // Re-split any still-too-long parts at the next-finer level.
  return parts.flatMap((p) => (p.length <= MAX_CHARS ? [p] : splitRecursive(p, depth + 1)));
}

function tail(s: string, n: number): string {
  if (s.length <= n) return s;
  // Prefer to break on whitespace.
  const slice = s.slice(s.length - n);
  const sp = slice.indexOf(' ');
  return sp > 0 ? slice.slice(sp + 1) : slice;
}
