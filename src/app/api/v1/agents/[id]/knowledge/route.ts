/**
 * Upload a knowledge file to a specific agent. The MVP processes the file inline
 * (parse → chunk → embed → upsert). Move to a background worker once volume warrants.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { withWorkspace } from '@/db/client';
import { agents, knowledgeFiles } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { newId } from '@/server/ids';
import { ingestFile } from '@/server/rag/ingest';

export const runtime = 'nodejs';
export const maxDuration = 300;

const ACCEPTED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
]);

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  const wsExt = session?.user?.workspaceExternalId;
  if (!wsId || !wsExt) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }

  const mime = file.type || 'application/octet-stream';
  if (!ACCEPTED.has(mime) && !file.name.match(/\.(pdf|docx|md|txt|html|csv)$/i)) {
    return NextResponse.json({ error: `Unsupported file type: ${mime}` }, { status: 415 });
  }
  if (file.size > 100 * 1024 * 1024) {
    return NextResponse.json({ error: 'File over 100 MB limit' }, { status: 413 });
  }

  // Resolve agent + version under tenancy fence.
  const found = await withWorkspace(wsId, async (tx) => {
    const [a] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, wsId), eq(agents.externalId, params.id)))
      .limit(1);
    return a;
  });
  if (!found) return NextResponse.json({ error: 'agent not found' }, { status: 404 });

  const fileExt = newId('kf');
  const dir = join(UPLOAD_DIR, wsExt, found.externalId);
  await mkdir(dir, { recursive: true });
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = join(dir, `${fileExt}_${safeName}`);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(storageKey, buf);

  // Insert pending row.
  const fileId = await withWorkspace(wsId, async (tx) => {
    const [row] = await tx
      .insert(knowledgeFiles)
      .values({
        externalId: fileExt,
        workspaceId: wsId,
        agentId: found.id,
        filename: file.name,
        mime,
        sizeBytes: file.size,
        storageKey,
        status: 'pending',
      })
      .returning({ id: knowledgeFiles.id });
    return row.id;
  });

  // Run ingestion. Inline for MVP — the route stays open until indexed.
  try {
    const result = await ingestFile({
      workspaceId: wsId,
      workspaceExternalId: wsExt,
      agentId: found.id,
      agentExternalId: found.externalId,
      agentVersion: found.currentVersion,
      fileId,
      fileExternalId: fileExt,
      filepath: storageKey,
      mime,
    });
    return NextResponse.json({
      file: { externalId: fileExt, status: 'indexed', chunkCount: result.chunkCount },
    });
  } catch (err) {
    console.error('[knowledge/upload] ingest failed', {
      file: file.name,
      mime,
      agent: found.externalId,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });
    return NextResponse.json(
      {
        file: { externalId: fileExt, status: 'failed' },
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
