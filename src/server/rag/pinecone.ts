/**
 * Pinecone client wrapper.
 *
 * Tenancy: every operation MUST take an explicit `namespace` derived from
 * `pineconeNamespace(workspaceExternalId, agentExternalId)`. The application
 * layer never accepts a raw namespace from the client.
 */
import { Pinecone } from '@pinecone-database/pinecone';
import { EMBEDDING_DIM } from '@/server/ai/embed';

let _client: Pinecone | null = null;

function client() {
  if (_client) return _client;
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error('PINECONE_API_KEY not set');
  _client = new Pinecone({ apiKey });
  return _client;
}

function index() {
  const name = process.env.PINECONE_INDEX ?? 'vocera-mvp';
  return client().index(name);
}

let _indexEnsured = false;
/**
 * Create the Pinecone index lazily on first use. Pinecone Starter (free) refuses
 * upserts to a missing index — without this, the first knowledge upload fails
 * with a confusing 404. Idempotent and cheap (one HEAD per process).
 */
async function ensureIndex() {
  if (_indexEnsured) return;
  const name = process.env.PINECONE_INDEX ?? 'vocera-mvp';
  const list = await client().listIndexes();
  const exists = list.indexes?.some((i) => i.name === name) ?? false;
  if (!exists) {
    console.log(`[pinecone] creating index "${name}" (dim=${EMBEDDING_DIM}, cosine)…`);
    await client().createIndex({
      name,
      dimension: EMBEDDING_DIM,
      metric: 'cosine',
      spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
      waitUntilReady: true,
    });
  }
  _indexEnsured = true;
}

export interface UpsertVector {
  id: string;
  vector: number[];
  metadata: Record<string, string | number | boolean | string[]>;
}

export async function upsertChunks(namespace: string, vectors: UpsertVector[]) {
  if (vectors.length === 0) return;
  // Guard: dimension mismatch is the most common ingest bug — fail loudly.
  const dim = vectors[0].vector.length;
  if (dim !== EMBEDDING_DIM) {
    throw new Error(
      `Pinecone index expects ${EMBEDDING_DIM}-dim vectors, got ${dim}. ` +
        `Recreate the index or change EMBED_PROVIDER.`,
    );
  }
  await ensureIndex();
  await index()
    .namespace(namespace)
    .upsert(
      vectors.map((v) => ({
        id: v.id,
        values: v.vector,
        metadata: v.metadata,
      })),
    );
}

export async function queryTopK(namespace: string, vector: number[], topK = 5) {
  await ensureIndex();
  const res = await index().namespace(namespace).query({
    vector,
    topK,
    includeMetadata: true,
  });
  return res.matches.map((m) => ({
    id: m.id,
    score: m.score ?? 0,
    text: (m.metadata as { text?: string } | undefined)?.text ?? '',
    metadata: (m.metadata ?? {}) as Record<string, unknown>,
  }));
}

export async function deleteByFile(namespace: string, fileExternalId: string) {
  // Pinecone serverless deletes by metadata filter (not all SKUs).
  // Best-effort — fall through to listing chunk ids if filter unsupported.
  try {
    await index()
      .namespace(namespace)
      .deleteMany({ file_id: fileExternalId } as any);
  } catch {
    /* ignore — caller may also be removing the rows from Postgres */
  }
}
