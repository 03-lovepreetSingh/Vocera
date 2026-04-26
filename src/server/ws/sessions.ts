/**
 * DB-backed voice session tokens.
 *
 * Why DB and not in-memory: Next.js Route Handlers run in their own webpack
 * module graph, while the WS upgrade handler runs in tsx's module graph. They
 * cannot share a Map. Postgres is the lowest-friction shared store both paths
 * already use.
 *
 * Token = short opaque id (`sess_<nanoid>`). The agent context is loaded fresh
 * from the DB on consume — keeps the URL short and removes any need to embed
 * sensitive data in the URL.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  agentVersions,
  agents,
  voiceSessions,
  workspaces,
} from '@/db/schema';
import type { AgentContext } from '@/server/ai/pipeline';
import { newId } from '@/server/ids';

const TTL_MS = 5 * 60 * 1000;

/** Mint a session token for a given workspace+agent. Caller is auth-validated. */
export async function issueSession(opts: {
  workspaceId: number;
  agentId: number;
}): Promise<string> {
  const token = newId('sess');
  await db.insert(voiceSessions).values({
    token,
    workspaceId: opts.workspaceId,
    agentId: opts.agentId,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return token;
}

/**
 * Consume a session token. Atomically deletes the row (single-use) and loads
 * the agent's current version + parent workspace external id so the WS handler
 * can build an `AgentContext` without further auth calls.
 */
export async function takeSession(
  token: string,
): Promise<{ agent: AgentContext; conversationId?: number } | null> {
  // Atomic delete-returning so concurrent connects can't race.
  const [row] = await db
    .delete(voiceSessions)
    .where(eq(voiceSessions.token, token))
    .returning({
      workspaceId: voiceSessions.workspaceId,
      agentId: voiceSessions.agentId,
      expiresAt: voiceSessions.expiresAt,
    });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  // Load agent + current version + workspace external id.
  const [data] = await db
    .select({
      agentExternalId: agents.externalId,
      currentVersion: agents.currentVersion,
      systemPrompt: agentVersions.systemPrompt,
      languages: agentVersions.languages,
      defaultLanguage: agentVersions.defaultLanguage,
      voiceMap: agentVersions.voiceMap,
      workspaceExternalId: workspaces.externalId,
    })
    .from(agents)
    .innerJoin(workspaces, eq(workspaces.id, agents.workspaceId))
    .innerJoin(
      agentVersions,
      sql`${agentVersions.agentId} = ${agents.id} AND ${agentVersions.version} = ${agents.currentVersion}`,
    )
    .where(eq(agents.id, row.agentId))
    .limit(1);
  if (!data) return null;

  return {
    agent: {
      agentId: row.agentId,
      agentExternalId: data.agentExternalId,
      workspaceExternalId: data.workspaceExternalId,
      systemPrompt: data.systemPrompt,
      languages: data.languages,
      defaultLanguage: data.defaultLanguage,
      voiceMap: (data.voiceMap ?? {}) as Record<string, string>,
    },
  };
}

/** Sweep expired sessions periodically. Cheap — small table. */
const SWEEPER_KEY = '__vocera_voice_sessions_sweeper__';
const sweepGlobal = globalThis as unknown as { [SWEEPER_KEY]?: boolean };
if (!sweepGlobal[SWEEPER_KEY]) {
  sweepGlobal[SWEEPER_KEY] = true;
  setInterval(async () => {
    try {
      await db.execute(sql`DELETE FROM voice_sessions WHERE expires_at < now()`);
    } catch {
      /* ignore */
    }
  }, 60_000).unref?.();
}
