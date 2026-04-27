/**
 * Document parsing — minimal MVP. Supports:
 *   PDF  via pdf-parse (no native deps)
 *   DOCX via mammoth
 *   MD/TXT via direct read
 *
 * Returns plain text. Layout/tables fidelity gets better with Unstructured.io
 * later (PRD §4.1) — keeping it simple here.
 */
import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';

export interface ParseResult {
  text: string;
  pageCount?: number;
}

export async function parseDocument(filepath: string, mime: string): Promise<ParseResult> {
  if (mime === 'application/pdf' || filepath.toLowerCase().endsWith('.pdf')) {
    // Import the inner module — pdf-parse's index.js runs debug code on import
    // that tries to read a hardcoded test PDF and crashes with ENOENT.
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const buf = await readFile(filepath);
    const out = await pdfParse(buf);
    return { text: out.text, pageCount: out.numpages };
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    filepath.toLowerCase().endsWith('.docx')
  ) {
    const buf = await readFile(filepath);
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { text: value };
  }
  // text/markdown, text/plain, text/html, text/csv — just read.
  const text = await readFile(filepath, 'utf8');
  return { text };
}
