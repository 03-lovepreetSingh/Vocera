'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Support Agents listing.
 *
 * Fetches deployments for surface='support'. The deployments API is owned by
 * the Voice Agents track — this page consumes it via fetch and degrades
 * cleanly (shows "No deployments yet") when the endpoint isn't yet wired up.
 *
 * Loading state is intentionally short-circuited after a single network round
 * trip; we never block UI on the API the way a server component would, since
 * the route may legitimately 404 during early development.
 */

type Deployment = {
  id?: string | number;
  externalId?: string;
  agentId?: string;
  agentName?: string;
  agent_name?: string;
  surface?: string;
  themeColor?: string;
  theme_color?: string;
  position?: string;
  welcomeMessage?: string;
  welcome_message?: string;
  createdAt?: string;
  created_at?: string;
};

export default function SupportListPage() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; deployments: Deployment[] }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/deployments?surface=support', {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        if (!res.ok) {
          // 404 is expected before the deployments API ships — treat as empty.
          if (res.status === 404) {
            if (!cancelled) setState({ kind: 'ready', deployments: [] });
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as { deployments?: Deployment[] } | Deployment[];
        const list = Array.isArray(json) ? json : (json.deployments ?? []);
        if (!cancelled) setState({ kind: 'ready', deployments: list });
      } catch (err) {
        if (!cancelled) {
          // Network failure or malformed response: fall back to empty list so
          // the user can still create a new deployment.
          setState({ kind: 'ready', deployments: [] });
          // Surface the underlying error in the console for ops triage.
          // eslint-disable-next-line no-console
          console.warn('[support] failed to load deployments', err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isLoading = state.kind === 'loading';
  const deployments = state.kind === 'ready' ? state.deployments : [];

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-line-soft bg-paper px-6">
        <h1 className="text-base font-semibold">Support Agents</h1>
        <Link
          href="/support/new"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-paper"
        >
          + New deployment
        </Link>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="mb-6">
          <h2 className="text-base font-semibold">Embedded chat widgets</h2>
          <p className="mt-1 text-sm text-ink-3">
            Deploy a support agent to your site as a chat widget. Drop one snippet, ship to
            every customer.
          </p>
        </div>

        {isLoading ? (
          <div className="rounded-lg border border-line-soft bg-paper px-5 py-12 text-center text-sm text-ink-3">
            Loading deployments…
          </div>
        ) : deployments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-soft bg-paper px-8 py-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium">No support deployments yet</p>
            <p className="mt-1 text-sm text-ink-3">
              Pick an existing AI agent and embed it on your site as a chat widget.
            </p>
            <Link
              href="/support/new"
              className="mt-5 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper"
            >
              Create your first deployment
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3">
            {deployments.map((d, i) => {
              const id = String(d.externalId ?? d.id ?? i);
              const name = d.agentName ?? d.agent_name ?? 'Untitled agent';
              const color = d.themeColor ?? d.theme_color ?? 'var(--accent)';
              const position = d.position ?? 'bottom-right';
              return (
                <li
                  key={id}
                  className="flex items-center justify-between rounded-lg border border-line-soft bg-paper px-5 py-4"
                >
                  <Link href={`/support/${id}`} className="flex flex-1 items-center gap-3">
                    <span
                      className="h-8 w-8 shrink-0 rounded-md"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium hover:text-accent">
                        {name}
                      </span>
                      <span className="block text-xs text-ink-3">
                        Chat widget · {position}
                      </span>
                    </span>
                  </Link>
                  <Link
                    href={`/support/${id}`}
                    className="text-xs text-ink-3 hover:text-ink"
                  >
                    Configure →
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
