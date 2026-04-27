/**
 * SSE chat endpoint — text-only sanity check for the agent's "brain" without audio.
 * Useful for the support-widget surface and for debugging when STT/TTS aren't set up.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { agentVersions, agents } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { embed } from '@/server/ai/embed';
import { type ChatMessage, streamCompletion } from '@/server/ai/llm';
import { queryTopK } from '@/server/rag/pinecone';
import { pineconeNamespace } from '@/server/ids';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Schema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(50)
    .optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  const wsExt = session?.user?.workspaceExternalId;
  if (!wsId || !wsExt) return new Response('unauthorized', { status: 401 });

  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return new Response('bad request', { status: 400 });

  const found = await withWorkspace(wsId, async (tx) => {
    const [a] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, wsId), eq(agents.externalId, params.id)))
      .limit(1);
    if (!a) return null;
    const [v] = await tx
      .select()
      .from(agentVersions)
      .where(
        and(eq(agentVersions.agentId, a.id), eq(agentVersions.version, a.currentVersion)),
      )
      .limit(1);
    return v ? { a, v } : null;
  });
  if (!found) return new Response('not found', { status: 404 });

  // Retrieval (best effort).
  let contextChunks: string[] = [];
  try {
    const [vec] = await embed([parsed.data.message], { inputType: 'query' });
    const matches = await queryTopK(
      pineconeNamespace(wsExt, found.a.externalId),
      vec,
      5,
    );
    contextChunks = matches.filter((m) => m.score >= 0.55).map((m) => m.text);
  } catch (err) {
    console.warn('[converse] retrieval failed (continuing without):', err);
  }

  const history: ChatMessage[] = [];
  if (contextChunks.length) {
    history.push({
      role: 'system',
      content: `<context>\n${contextChunks.join('\n---\n')}\n</context>`,
    });
  }
  for (const m of parsed.data.history ?? []) {
    history.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  history.push({ role: 'user', content: parsed.data.message });

  const stream = streamCompletion({ systemPrompt: found.v.systemPrompt, history });

  const encoder = new TextEncoder();
  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.delta) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'text', delta: chunk.delta })}\n\n`),
            );
          } else {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'end',
                  inputTokens: chunk.inputTokens,
                  outputTokens: chunk.outputTokens,
                })}\n\n`,
              ),
            );
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sse, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
