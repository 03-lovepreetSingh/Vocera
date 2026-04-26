/**
 * Create a voice deployment — pick an AI agent and we provision a webhook URL
 * + signing secret on the fly. The form posts to /api/v1/deployments and then
 * redirects to /voice/[externalId] for the full setup view.
 */
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bot, Phone } from '@/components/icons';

interface AgentRow {
  id: number;
  externalId: string;
  name: string;
  purpose: string;
  currentVersion: number;
  status: string;
}

interface SurfaceFlags {
  ivr: boolean;
  outbound: boolean;
  custom: boolean;
}

const SURFACE_OPTIONS: Array<{ key: keyof SurfaceFlags; title: string; desc: string }> = [
  { key: 'ivr', title: 'IVR — Inbound', desc: 'Plug a webhook URL into your Twilio number.' },
  {
    key: 'outbound',
    title: 'Calling agent — Outbound',
    desc: 'Trigger calls from your CRM or a CSV.',
  },
  {
    key: 'custom',
    title: 'Custom integration',
    desc: 'Use the webhook anywhere — web, mobile, IoT.',
  },
];

export default function NewVoiceDeploymentPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentId, setAgentId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [surfaces, setSurfaces] = useState<SurfaceFlags>({
    ivr: true,
    outbound: false,
    custom: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load workspace's agents so the user can pick one. We just call the same
  // REST endpoint the dashboard uses; cookie auth handles tenancy.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/agents');
        if (!res.ok) throw new Error(`Failed to load agents (${res.status})`);
        const json = (await res.json()) as { agents: AgentRow[] };
        if (cancelled) return;
        setAgents(json.agents);
        if (json.agents.length > 0 && !agentId) setAgentId(json.agents[0].externalId);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // We deliberately omit `agentId` from deps — only pre-fill on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agentId) {
      setError('Pick an AI agent first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/deployments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          surface: 'voice',
          name: name.trim() || null,
          surfaces,
          config: {},
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ? JSON.stringify(j.error) : `Request failed (${res.status})`);
      }
      const json = (await res.json()) as { deployment: { externalId: string } };
      router.push(`/voice/${json.deployment.externalId}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-line-soft bg-paper px-6">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/voice" className="text-ink-3 hover:text-ink">
            Voice Agents
          </Link>
          <span className="text-ink-4">/</span>
          <span className="font-semibold">New voice agent</span>
        </div>
      </header>

      <main className="flex-1 px-6 py-6">
        <form
          onSubmit={handleSubmit}
          className="mx-auto grid w-full max-w-2xl gap-6"
        >
          <div className="rounded-lg border border-line-soft bg-paper p-5">
            <div className="mb-1 text-sm font-semibold">1 · Pick an AI agent</div>
            <p className="mb-3 text-xs text-ink-3">
              Voice deployments wrap an existing AI agent. Pick the brain — we'll handle the
              telephony glue.
            </p>

            {loading ? (
              <div className="rounded-md border border-dashed border-line-soft bg-fill px-4 py-6 text-center text-xs text-ink-3">
                Loading agents…
              </div>
            ) : agents.length === 0 ? (
              <div className="rounded-md border border-dashed border-line-soft bg-fill px-4 py-6 text-center text-sm">
                <p className="text-ink-3">You don't have any AI agents yet.</p>
                <Link
                  href="/agents/new"
                  className="mt-2 inline-block rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-paper"
                >
                  Create one first
                </Link>
              </div>
            ) : (
              <ul className="grid gap-2">
                {agents.map((a) => {
                  const selected = a.externalId === agentId;
                  return (
                    <li key={a.externalId}>
                      <button
                        type="button"
                        onClick={() => setAgentId(a.externalId)}
                        className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition ${
                          selected
                            ? 'border-accent bg-accent-soft'
                            : 'border-line-soft bg-paper hover:bg-fill'
                        }`}
                      >
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                            selected ? 'bg-paper' : 'bg-accent-soft'
                          }`}
                        >
                          <Bot className="h-4 w-4 text-accent" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{a.name}</div>
                          <div className="truncate text-[11px] text-ink-3">
                            {a.purpose} · v{a.currentVersion} · {a.status}
                          </div>
                        </div>
                        <span
                          className={`h-4 w-4 rounded-full border-2 ${
                            selected ? 'border-accent bg-accent' : 'border-line-soft'
                          }`}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-line-soft bg-paper p-5">
            <div className="mb-1 text-sm font-semibold">2 · Name this deployment</div>
            <p className="mb-3 text-xs text-ink-3">
              Optional — helps when one agent is deployed to multiple phone numbers.
            </p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Northwind Support — main line"
              className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm placeholder:text-ink-4 focus:border-accent focus:outline-none"
            />
          </div>

          <div className="rounded-lg border border-line-soft bg-paper p-5">
            <div className="mb-1 text-sm font-semibold">3 · How will it be used?</div>
            <p className="mb-3 text-xs text-ink-3">
              Pick all that apply. You can change this any time.
            </p>
            <div className="grid gap-2">
              {SURFACE_OPTIONS.map((o) => {
                const sel = surfaces[o.key];
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() =>
                      setSurfaces((s) => ({ ...s, [o.key]: !s[o.key] }))
                    }
                    className={`flex items-start gap-3 rounded-md border px-3 py-3 text-left transition ${
                      sel
                        ? 'border-accent bg-accent-soft'
                        : 'border-line-soft bg-paper hover:bg-fill'
                    }`}
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-paper">
                      <Phone className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{o.title}</div>
                      <div className="text-xs text-ink-3">{o.desc}</div>
                    </div>
                    <span
                      className={`mt-1 h-4 w-4 shrink-0 rounded border-2 ${
                        sel ? 'border-accent bg-accent' : 'border-line-soft'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <Link href="/voice" className="text-sm text-ink-3 hover:text-ink">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !agentId || agents.length === 0}
              className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-paper disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Creating…' : 'Create voice agent'}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
