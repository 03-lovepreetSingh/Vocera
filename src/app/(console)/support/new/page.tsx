'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Create a new Support deployment.
 *
 * Lists the workspace's agents (via the public agents listing API if present;
 * falls back to an empty picker that prompts the user to create an agent
 * first) and lets the user spin up a chat-widget deployment.
 *
 * The actual create call is `POST /api/v1/deployments {surface:'support', agent_id}`.
 * The endpoint is owned by the Voice Agents track; we surface its error verbatim
 * so failures during early development are obvious.
 */

type AgentRow = {
  externalId: string;
  name: string;
  purpose: string;
  currentVersion: number;
  status: string;
};

type AgentApiRow = Partial<AgentRow> & {
  external_id?: string;
  current_version?: number;
};

export default function NewSupportDeploymentPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [selected, setSelected] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/agents', {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { agents?: AgentApiRow[] } | AgentApiRow[];
        const list = Array.isArray(json) ? json : (json.agents ?? []);
        const normalised: AgentRow[] = list
          .map((a) => ({
            externalId: a.externalId ?? a.external_id ?? '',
            name: a.name ?? '',
            purpose: a.purpose ?? '',
            currentVersion: a.currentVersion ?? a.current_version ?? 1,
            status: a.status ?? 'draft',
          }))
          .filter((a) => a.externalId && a.name);
        if (!cancelled) {
          setAgents(normalised);
          setSelected(normalised[0]?.externalId ?? '');
        }
      } catch (err) {
        // Agents listing API may not be live yet; surface a friendly empty state.
        // eslint-disable-next-line no-console
        console.warn('[support/new] failed to load agents', err);
      } finally {
        if (!cancelled) setLoadingAgents(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/deployments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ surface: 'support', agent_id: selected }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        id?: string | number;
        externalId?: string;
        external_id?: string;
        deployment?: { externalId?: string; external_id?: string; id?: string | number };
      };
      const dep = data.deployment ?? data;
      const id = dep.externalId ?? dep.external_id ?? dep.id;
      router.push(id ? `/support/${id}` : '/support');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create deployment');
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-line-soft bg-paper px-6">
        <h1 className="text-base font-semibold">
          <Link href="/support" className="text-ink-3 hover:text-ink">
            Support Agents
          </Link>
          <span className="mx-2 text-ink-4">/</span>
          New deployment
        </h1>
        <Link
          href="/support"
          className="rounded-md border border-line-soft px-3 py-1.5 text-sm hover:bg-fill"
        >
          Cancel
        </Link>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-lg border border-line-soft bg-paper px-6 py-6">
            <h2 className="text-base font-semibold">Pick an AI agent</h2>
            <p className="mt-1 text-sm text-ink-3">
              The agent's prompt, knowledge base, and lead fields will all be reused for this
              chat widget.
            </p>

            <div className="mt-5">
              {loadingAgents ? (
                <div className="rounded-md border border-line-soft bg-fill px-4 py-6 text-center text-sm text-ink-3">
                  Loading agents…
                </div>
              ) : agents.length === 0 ? (
                <div className="rounded-md border border-dashed border-line-soft bg-fill px-4 py-6 text-center">
                  <p className="text-sm text-ink-3">
                    You don't have any agents yet. Create one first.
                  </p>
                  <Link
                    href="/agents/new"
                    className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-paper"
                  >
                    Create agent
                  </Link>
                </div>
              ) : (
                <ul className="grid gap-2">
                  {agents.map((a) => {
                    const active = a.externalId === selected;
                    return (
                      <li key={a.externalId}>
                        <button
                          type="button"
                          onClick={() => setSelected(a.externalId)}
                          className={`flex w-full items-center justify-between rounded-md border px-4 py-3 text-left transition ${
                            active
                              ? 'border-accent bg-accent-soft'
                              : 'border-line-soft bg-paper hover:bg-fill'
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <span
                              className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium ${
                                active
                                  ? 'bg-accent text-paper'
                                  : 'bg-fill-2 text-ink-3'
                              }`}
                            >
                              {a.name.charAt(0).toUpperCase()}
                            </span>
                            <span>
                              <span className="block text-sm font-medium">{a.name}</span>
                              <span className="block text-xs text-ink-3">
                                {a.purpose} · v{a.currentVersion} · {a.status}
                              </span>
                            </span>
                          </span>
                          {active ? (
                            <span className="text-xs font-medium text-accent">Selected</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {error ? (
              <p className="mt-4 rounded-md border border-err/30 bg-err/5 px-3 py-2 text-xs text-err">
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-2">
              <Link
                href="/support"
                className="rounded-md border border-line-soft bg-paper px-4 py-2 text-sm hover:bg-fill"
              >
                Cancel
              </Link>
              <button
                type="button"
                disabled={!selected || submitting || loadingAgents}
                onClick={handleCreate}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create deployment'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
