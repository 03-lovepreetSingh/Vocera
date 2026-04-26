import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { withWorkspace } from '@/db/client';
import { agents, conversations } from '@/db/schema';
import { auth } from '@/server/auth/config';

export default async function DashboardPage(props: { searchParams: { onboarding?: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const { agentList, recentConversations } = await withWorkspace(wsId, async (tx) => {
    const a = await tx.select().from(agents).where(eq(agents.workspaceId, wsId)).orderBy(desc(agents.createdAt)).limit(10);
    const c = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.workspaceId, wsId))
      .orderBy(desc(conversations.startedAt))
      .limit(10);
    return { agentList: a, recentConversations: c };
  });

  const isEmpty = agentList.length === 0;

  return (
    <>
      <AppTopbar title="Dashboard" />
      <main className="flex-1 px-6 py-6">
        {props.searchParams.onboarding === '1' && (
          <div className="mb-6 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">
            Welcome to Vocera. Create your first AI agent to get started.
          </div>
        )}

        <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction
            href="/agents/new"
            title="Create AI agent"
            subtitle="Wizard · 3 steps"
            accent
          />
          <QuickAction href="/agents" title="All agents" subtitle="Manage and edit" />
          <QuickAction href="/logs" title="Call logs" subtitle="Transcripts and audio" />
          <QuickAction href="/analysis" title="Analysis" subtitle="Leads and intents" />
        </section>

        {isEmpty ? (
          <EmptyState />
        ) : (
          <section className="grid gap-6 lg:grid-cols-2">
            <Card title="AI Agents">
              <ul className="divide-y divide-line-soft">
                {agentList.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-3">
                    <Link href={`/agents/${a.externalId}`} className="hover:text-accent">
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-ink-3">
                        {a.purpose} · v{a.currentVersion} · {a.status}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Recent conversations">
              {recentConversations.length === 0 ? (
                <p className="text-sm text-ink-3">No conversations yet.</p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {recentConversations.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-3">
                      <div>
                        <div className="font-medium">
                          {c.callerName ?? c.callerId ?? 'Anonymous'}
                        </div>
                        <div className="text-xs text-ink-3">
                          {c.channel} · {c.status}
                        </div>
                      </div>
                      <div className="text-xs text-ink-3">
                        {new Date(c.startedAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        )}
      </main>
    </>
  );
}

function QuickAction({
  href,
  title,
  subtitle,
  accent,
}: {
  href: string;
  title: string;
  subtitle: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg border border-line-soft px-4 py-4 transition ${
        accent ? 'bg-accent text-paper hover:opacity-90' : 'bg-paper hover:bg-fill'
      }`}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className={`text-xs ${accent ? 'text-paper/70' : 'text-ink-3'}`}>{subtitle}</div>
    </Link>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-line-soft bg-paper px-8 py-16 text-center">
      <h2 className="text-lg font-semibold">Create your first AI agent</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
        Pick a purpose, drop in your knowledge base, and your agent is ready to talk in minutes.
      </p>
      <Link
        href="/agents/new"
        className="mt-6 inline-block rounded-md bg-accent px-5 py-2.5 font-medium text-paper"
      >
        Start the wizard
      </Link>
    </div>
  );
}
