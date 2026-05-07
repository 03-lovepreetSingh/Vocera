interface PdfParseResult {
  numpages: number;
  numrender: number;
  info: unknown;
  metadata: unknown;
  text: string;
  version: string;
}

declare module 'pdf-parse' {
  function pdfParse(buf: Buffer | Uint8Array, opts?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}

declare module 'pdf-parse/lib/pdf-parse.js' {
  function pdfParse(buf: Buffer | Uint8Array, opts?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}
