import { eq } from 'drizzle-orm';
import { db, withWorkspace } from '@/db/client';
import { conversations, messages, workspaces } from '@/db/schema';
import { newId } from '@/server/ids';

export type CallDirection = 'inbound' | 'outbound';

export interface CreateConversationOpts {
  workspaceExternalId: string;
  agentId: number;
  channel: 'custom' | 'voice' | 'web' | 'sms'; // 'voice' for Twilio path
  direction: CallDirection;
  externalCallSid?: string | null; // Twilio CallSid, if any
}

export async function createConversation(opts: CreateConversationOpts): Promise<number> {
  // Need workspace_id (numeric) — look it up from external id once per call.
  const wsId = await resolveWorkspaceId(opts.workspaceExternalId);
  return withWorkspace(wsId, async (tx) => {
    const [row] = await tx
      .insert(conversations)
      .values({
        externalId: newId('ca'),
        workspaceId: wsId,
        agentId: opts.agentId,
        channel: opts.channel,
        direction: opts.direction,
        externalCallSid: opts.externalCallSid ?? null,
        status: 'in-progress',
      })
      .returning({ id: conversations.id });
    return row.id;
  });
}

export interface PersistMessageOpts {
  workspaceExternalId: string;
  conversationId: number;
  role: 'user' | 'agent' | 'tool' | 'system';
  content: string;
  language?: string;
  ttftMs: number | null;
}

export async function persistMessage(opts: PersistMessageOpts): Promise<void> {
  const wsId = await resolveWorkspaceId(opts.workspaceExternalId);
  await withWorkspace(wsId, async (tx) => {
    // Determine next turn index — small race is fine for an MVP test surface.
    const existing = await tx
      .select({ ti: messages.turnIndex })
      .from(messages)
      .where(eq(messages.conversationId, opts.conversationId));
    const nextTurn = (existing.reduce((m, r) => Math.max(m, r.ti), -1) ?? -1) + 1;
    await tx.insert(messages).values({
      workspaceId: wsId,
      conversationId: opts.conversationId,
      turnIndex: nextTurn,
      role: opts.role,
      content: opts.content,
      language: opts.language ?? null,
      ttftMs: opts.ttftMs ?? null,
    });
  });
}

export async function closeConversation(opts: {
  workspaceExternalId: string;
  conversationId: number;
}): Promise<void> {
  const wsId = await resolveWorkspaceId(opts.workspaceExternalId);
  await withWorkspace(wsId, async (tx) => {
    await tx
      .update(conversations)
      .set({ status: 'completed', endedAt: new Date() })
      .where(eq(conversations.id, opts.conversationId));
  });
}

// Avoid resolving once-per-call repeatedly: in-memory cache keyed by external id.
const wsIdCache = new Map<string, number>();
export async function resolveWorkspaceId(externalId: string): Promise<number> {
  const hit = wsIdCache.get(externalId);
  if (hit) return hit;
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.externalId, externalId))
    .limit(1);
  if (!row) throw new Error(`workspace not found: ${externalId}`);
  wsIdCache.set(externalId, row.id);
  return row.id;
}
