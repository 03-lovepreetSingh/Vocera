declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  }
  function pdfParse(buf: Buffer | Uint8Array, opts?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}
