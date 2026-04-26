import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { withWorkspace } from '@/db/client';
import { agents } from '@/db/schema';
import { auth } from '@/server/auth/config';

export default async function AgentsPage() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const list = await withWorkspace(wsId, (tx) =>
    tx.select().from(agents).where(eq(agents.workspaceId, wsId)).orderBy(desc(agents.createdAt)),
  );

  return (
    <>
      <AppTopbar title="AI Agents" />
      <main className="flex-1 px-6 py-6">
        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-soft bg-paper px-8 py-12 text-center">
            <p className="text-sm text-ink-3">No agents yet.</p>
            <Link
              href="/agents/new"
              className="mt-4 inline-block rounded-md bg-accent px-4 py-2 font-medium text-paper"
            >
              Create your first agent
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3">
            {list.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-lg border border-line-soft bg-paper px-5 py-4"
              >
                <Link href={`/agents/${a.externalId}`} className="hover:text-accent">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-ink-3">
                    {a.purpose} · v{a.currentVersion} · {a.status}
                  </div>
                </Link>
                <Link
                  href={`/agents/${a.externalId}`}
                  className="text-xs text-ink-3 hover:text-ink"
                >
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
