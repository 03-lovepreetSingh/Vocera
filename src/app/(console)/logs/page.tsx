/**
 * Call Logs page.
 *
 * Server-rendered table of recent conversations + a client island that owns
 * the transcript drawer state. The drawer fetches details on demand from
 * /api/v1/conversations/:externalId/transcript.
 */
import { desc, eq } from 'drizzle-orm';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { withWorkspace } from '@/db/client';
import { agents, conversations } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { LogsView, type LogRow } from '@/components/logs/TranscriptDrawer';

export const dynamic = 'force-dynamic';

export default async function LogsPage() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const dbRows = await withWorkspace(wsId, async (tx) =>
    tx
      .select({
        externalId: conversations.externalId,
        agentName: agents.name,
        agentExternalId: agents.externalId,
        callerId: conversations.callerId,
        callerName: conversations.callerName,
        intent: conversations.intent,
        sentiment: conversations.sentiment,
        channel: conversations.channel,
        status: conversations.status,
        durationMs: conversations.durationMs,
        languages: conversations.detectedLanguages,
        startedAt: conversations.startedAt,
      })
      .from(conversations)
      .innerJoin(agents, eq(agents.id, conversations.agentId))
      .where(eq(conversations.workspaceId, wsId))
      .orderBy(desc(conversations.startedAt))
      .limit(100),
  );

  const rows: LogRow[] = dbRows.map((r) => ({
    externalId: r.externalId,
    callerLabel: r.callerName || r.callerId || '—',
    agentName: r.agentName,
    agentExternalId: r.agentExternalId,
    intent: r.intent ?? null,
    sentiment: r.sentiment ?? null,
    channel: r.channel,
    status: r.status,
    durationMs: r.durationMs ?? null,
    languages: r.languages ?? [],
    startedAt: r.startedAt.toISOString(),
  }));

  // Distinct agents for the filter dropdown.
  const agentNames = Array.from(new Set(rows.map((r) => r.agentName))).sort();

  return (
    <>
      <AppTopbar title="Call Logs" />
      <main className="flex-1 overflow-hidden bg-fill">
        <LogsView rows={rows} agentNames={agentNames} />
      </main>
    </>
  );
}
