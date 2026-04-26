/**
 * Embedding provider abstraction. Supports Voyage-3 (1024-dim, multilingual) and
 * OpenAI text-embedding-3-small (1536-dim). Pick via EMBED_PROVIDER env var.
 *
 * Important: Pinecone's index dimension must match the chosen provider. The
 * dashboard surfaces this — see .env.example.
 */

const PROVIDER = (process.env.EMBED_PROVIDER ?? 'voyage').toLowerCase() as 'voyage' | 'openai';

export const EMBEDDING_DIM = PROVIDER === 'openai' ? 1536 : 1024;

export interface EmbedOptions {
  /** 'document' for ingestion, 'query' for retrieval. Voyage uses input_type. */
  inputType: 'document' | 'query';
}

export async function embed(texts: string[], opts: EmbedOptions): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (PROVIDER === 'openai') return embedOpenAI(texts);
  return embedVoyage(texts, opts.inputType);
}

async function embedVoyage(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY not set');

  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      input: texts,
      model: 'voyage-3',
      input_type: inputType,
    }),
    keepalive: true,
  });
  if (!res.ok) throw new Error(`Voyage embed failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ input: texts, model: 'text-embedding-3-small' }),
    keepalive: true,
  });
  if (!res.ok) throw new Error(`OpenAI embed failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}
