import { AppTopbar } from '@/components/layout/AppTopbar';
import { withWorkspace } from '@/db/client';
import { agents } from '@/db/schema';
import { cn } from '@/lib/utils';
import { auth } from '@/server/auth/config';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

/**
 * Layout for a single agent's builder.
 *
 * - Loads the agent once (RLS-scoped by workspace) so children can assume it exists.
 * - Renders the topbar and a server-rendered left sub-nav with four tabs:
 *   Basic Info / Prompt / Knowledge / Voice.
 * - Active tab is detected from the request pathname forwarded by Next via
 *   server-component request headers (`next-url`, with fallbacks).
 */
export default async function AgentDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const agent = await withWorkspace(wsId, async (tx) => {
    const [a] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, wsId), eq(agents.externalId, params.id)))
      .limit(1);
    return a ?? null;
  });

  if (!agent) return notFound();

  const h = headers();
  const fullUrl =
    h.get('next-url') ?? h.get('x-invoke-path') ?? h.get('x-pathname') ?? h.get('referer') ?? '';
  let pathname = '';
  try {
    pathname = fullUrl.startsWith('http') ? new URL(fullUrl).pathname : fullUrl;
  } catch {
    pathname = fullUrl;
  }

  const base = `/agents/${agent.externalId}`;
  const tabs = [
    { href: base, label: 'Basic Info', hint: 'Name, language, status' },
    { href: `${base}/prompt`, label: 'Prompt', hint: 'Persona + instructions' },
    { href: `${base}#knowledge`, label: 'Knowledge', hint: 'Docs the agent reads' },
    { href: `${base}/voice`, label: 'Voice', hint: 'Voice + speaking speed' },
  ];

  function isActive(href: string): boolean {
    const target = href.split('#')[0].replace(/\/$/, '');
    const current = pathname.split('?')[0].split('#')[0].replace(/\/$/, '');
    if (target === base) return current === base;
    return current === target || current.startsWith(`${target}/`);
  }

  return (
    <>
      <AppTopbar title={agent.name} />
      <div className="flex flex-1 items-stretch overflow-hidden">
        <aside className="hidden w-[232px] shrink-0 flex-col border-r border-line-soft bg-paper py-4 md:flex">
          <div className="px-4 pb-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">
            Configure
          </div>
          <nav className="flex flex-col gap-0.5 px-2">
            {tabs.map((t) => {
              const active = isActive(t.href);
              return (
                <Link
                  key={t.label}
                  href={t.href}
                  className={cn(
                    'rounded-md border-l-2 px-3 py-2 text-sm transition',
                    active
                      ? 'border-l-accent bg-fill text-ink'
                      : 'border-l-transparent text-ink-2 hover:bg-fill',
                  )}
                >
                  <div className="font-medium">{t.label}</div>
                  {active ? <div className="mt-0.5 text-[11px] text-ink-3">{t.hint}</div> : null}
                </Link>
              );
            })}
          </nav>
          <div className="mx-3 my-3 border-t border-line-softer" />
          <div className="px-4 text-[11px] text-ink-3">
            <div>Status: {agent.status}</div>
            <div>Version: v{agent.currentVersion}</div>
          </div>
        </aside>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </>
  );
}
