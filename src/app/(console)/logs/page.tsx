import { desc, eq } from 'drizzle-orm';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { withWorkspace } from '@/db/client';
import { agents, conversations } from '@/db/schema';
import { auth } from '@/server/auth/config';

export default async function LogsPage() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const rows = await withWorkspace(wsId, async (tx) =>
    tx
      .select({
        id: conversations.id,
        externalId: conversations.externalId,
        agentName: agents.name,
        channel: conversations.channel,
        status: conversations.status,
        durationMs: conversations.durationMs,
        languages: conversations.detectedLanguages,
        startedAt: conversations.startedAt,
        endedAt: conversations.endedAt,
      })
      .from(conversations)
      .innerJoin(agents, eq(agents.id, conversations.agentId))
      .where(eq(conversations.workspaceId, wsId))
      .orderBy(desc(conversations.startedAt))
      .limit(50),
  );

  return (
    <>
      <AppTopbar title="Call Logs" />
      <main className="flex-1 px-6 py-6">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-soft bg-paper px-8 py-12 text-center text-sm text-ink-3">
            No conversations yet. Click "Talk to agent" on an agent to test.
          </div>
        ) : (
          <table className="w-full overflow-hidden rounded-lg border border-line-soft bg-paper text-sm">
            <thead className="bg-fill text-left text-xs uppercase text-ink-3">
              <tr>
                <th className="px-4 py-2.5">Agent</th>
                <th className="px-4 py-2.5">Channel</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Languages</th>
                <th className="px-4 py-2.5">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-medium">{r.agentName}</td>
                  <td className="px-4 py-2.5 text-ink-3">{r.channel}</td>
                  <td className="px-4 py-2.5">{r.status}</td>
                  <td className="px-4 py-2.5 text-ink-3">{(r.languages ?? []).join(', ') || '—'}</td>
                  <td className="px-4 py-2.5 text-ink-3">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
