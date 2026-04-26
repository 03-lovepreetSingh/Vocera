/**
 * Synchronous ingestion: parse → chunk → embed → upsert to Pinecone, then write
 * chunk rows to Postgres.
 *
 * MVP runs this inline in the upload route handler. Beyond ~10 MB files this is
 * fine for a single user; for multi-tenant scale move to SQS + worker (PRD §4.1).
 */
import { eq } from 'drizzle-orm';
import { withWorkspace } from '@/db/client';
import { knowledgeChunks, knowledgeFiles } from '@/db/schema';
import { embed } from '@/server/ai/embed';
import { newId, pineconeNamespace } from '@/server/ids';
import { chunkText } from './chunk';
import { parseDocument } from './parse';
import { upsertChunks } from './pinecone';

export interface IngestInput {
  workspaceId: number;
  workspaceExternalId: string;
  agentId: number;
  agentExternalId: string;
  agentVersion: number;
  fileId: number;
  fileExternalId: string;
  filepath: string;
  mime: string;
}

export async function ingestFile(input: IngestInput) {
  const namespace = pineconeNamespace(input.workspaceExternalId, input.agentExternalId);

  await withWorkspace(input.workspaceId, async (tx) => {
    await tx
      .update(knowledgeFiles)
      .set({ status: 'indexing' })
      .where(eq(knowledgeFiles.id, input.fileId));
  });

  try {
    const parsed = await parseDocument(input.filepath, input.mime);
    const chunks = chunkText(parsed.text);
    if (chunks.length === 0) throw new Error('Document produced 0 chunks (empty?)');

    // Batch embeddings — 100 chunks per request keeps latency and request size sane.
    const BATCH = 100;
    const allVectors: { id: string; text: string; chunkIndex: number; vector: number[] }[] = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const vecs = await embed(
        batch.map((c) => c.text),
        { inputType: 'document' },
      );
      batch.forEach((c, j) => {
        allVectors.push({
          id: newId('kc'),
          text: c.text,
          chunkIndex: c.index,
          vector: vecs[j],
        });
      });
    }

    await upsertChunks(
      namespace,
      allVectors.map((v) => ({
        id: v.id,
        vector: v.vector,
        metadata: {
          text: v.text,
          file_id: input.fileExternalId,
          agent_version: input.agentVersion,
          chunk_index: v.chunkIndex,
        },
      })),
    );

    await withWorkspace(input.workspaceId, async (tx) => {
      await tx.insert(knowledgeChunks).values(
        allVectors.map((v) => ({
          externalId: v.id,
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          fileId: input.fileId,
          chunkIndex: v.chunkIndex,
          text: v.text,
          agentVersion: input.agentVersion,
        })),
      );
      await tx
        .update(knowledgeFiles)
        .set({ status: 'indexed', chunkCount: allVectors.length, indexedAt: new Date() })
        .where(eq(knowledgeFiles.id, input.fileId));
    });

    return { chunkCount: allVectors.length };
  } catch (err) {
    await withWorkspace(input.workspaceId, async (tx) => {
      await tx
        .update(knowledgeFiles)
        .set({ status: 'failed', errorMessage: String(err).slice(0, 1000) })
        .where(eq(knowledgeFiles.id, input.fileId));
    });
    throw err;
  }
}
