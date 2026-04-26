/**
 * GET /api/v1/conversations/:id/transcript
 *
 * Returns the conversation row + ordered messages for the transcript drawer.
 * Workspace-scoped via withWorkspace — RLS rejects rows from other workspaces
 * even if a caller passes an externalId they don't own.
 */
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { withWorkspace } from '@/db/client';
import { agents, conversations, messages } from '@/db/schema';
import { auth } from '@/server/auth/config';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const wsId = session?.user?.workspaceId;
    if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const data = await withWorkspace(wsId, async (tx) => {
      const [conv] = await tx
        .select({
          id: conversations.id,
          externalId: conversations.externalId,
          channel: conversations.channel,
          direction: conversations.direction,
          callerId: conversations.callerId,
          callerName: conversations.callerName,
          status: conversations.status,
          durationMs: conversations.durationMs,
          intent: conversations.intent,
          sentiment: conversations.sentiment,
          detectedLanguages: conversations.detectedLanguages,
          startedAt: conversations.startedAt,
          endedAt: conversations.endedAt,
          agentName: agents.name,
          agentExternalId: agents.externalId,
        })
        .from(conversations)
        .innerJoin(agents, eq(agents.id, conversations.agentId))
        .where(
          and(
            eq(conversations.workspaceId, wsId),
            eq(conversations.externalId, params.id),
          ),
        )
        .limit(1);

      if (!conv) return null;

      const msgs = await tx
        .select({
          turnIndex: messages.turnIndex,
          role: messages.role,
          content: messages.content,
          language: messages.language,
          toolName: messages.toolName,
          ttftMs: messages.ttftMs,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(asc(messages.turnIndex));

      return { conversation: conv, messages: msgs };
    });

    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error('[transcript] FAILED', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
