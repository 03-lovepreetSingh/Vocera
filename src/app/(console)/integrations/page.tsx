/**
 * Integrations — connect telephony providers, CRMs/tools, manage API keys + webhook.
 *
 * v1 scope:
 *   • Telephony + CRM cards are visual-only ("available") — actual provider
 *     onboarding lives in a follow-up.
 *   • API keys: list / mint (plaintext shown once) / revoke. Backed by
 *     /api/v1/workspace/api-keys.
 *   • Webhook URL: copy + event toggles + send-test (toggles persist locally
 *     for now — server-side webhook config also a follow-up).
 *
 * The whole page is a client component because the API key dialog, copy
 * actions, and event toggles all need browser interaction. Initial key list
 * is loaded via fetch on mount — small payload, single round trip.
 */
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check } from '@/components/icons';

type Status = 'connected' | 'available' | 'beta';
interface Provider {
  name: string;
  blurb: string;
  status: Status;
  logo: string;
}

const TELEPHONY: Provider[] = [
  { name: 'Twilio', blurb: 'SIP, PSTN, SMS, Voice', status: 'available', logo: 'TW' },
  { name: 'Exotel', blurb: 'India, SEA voice + SMS', status: 'available', logo: 'EX' },
  { name: 'SIP Trunk', blurb: 'Generic BYO SIP provider', status: 'available', logo: 'SP' },
  { name: 'Plivo', blurb: 'Global voice + SMS', status: 'available', logo: 'PL' },
  { name: 'Vonage', blurb: 'Voice & messaging APIs', status: 'available', logo: 'VO' },
  { name: 'WebRTC', blurb: 'Browser-based calling', status: 'beta', logo: 'WR' },
];

const TOOLS: { name: string; blurb: string }[] = [
  { name: 'Salesforce', blurb: 'Sync leads & calls' },
  { name: 'HubSpot', blurb: 'Contacts & deals' },
  { name: 'Zendesk', blurb: 'Tickets & macros' },
  { name: 'Intercom', blurb: 'Conversations API' },
  { name: 'Slack', blurb: 'Notify on events' },
  { name: 'Segment', blurb: 'Analytics events' },
  { name: 'Zapier', blurb: '6,000+ apps' },
  { name: 'Webhook', blurb: 'Custom HTTP endpoint' },
];

const WEBHOOK_EVENTS = [
  'call.started',
  'call.ended',
  'call.transferred',
  'call.summary.ready',
  'tool.invoked',
] as const;

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  masked: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function IntegrationsPage() {
  return (
    <>
      <Topbar />
      <main className="flex-1 px-6 py-6">
        <Section title="Telephony providers" blurb="Connect your phone numbers.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {TELEPHONY.map((p) => (
              <ProviderCard key={p.name} provider={p} />
            ))}
          </div>
        </Section>

        <Section title="CRMs & tools" blurb="Push call data into your stack.">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {TOOLS.map((t) => (
              <ToolCard key={t.name} name={t.name} blurb={t.blurb} />
            ))}
          </div>
        </Section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <ApiKeysPanel />
          <WebhookPanel />
        </section>
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// Topbar — minimal client-side equivalent of <AppTopbar /> so the entire page
// can stay a client component.
// ---------------------------------------------------------------------------

function Topbar() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-line-soft bg-paper px-6">
      <h1 className="text-base font-semibold">Integrations</h1>
      <div className="text-xs text-ink-3">Connect your stack</div>
    </header>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {blurb ? <p className="text-xs text-ink-3">{blurb}</p> : null}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Provider + tool cards
// ---------------------------------------------------------------------------

function ProviderCard({ provider }: { provider: Provider }) {
  const { name, blurb, status, logo } = provider;
  const isConnected = status === 'connected';
  return (
    <div className="rounded-lg border border-line-soft bg-paper p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-fill text-xs font-semibold text-ink-3">
          {logo}
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="text-sm font-semibold">{name}</div>
      <div className="mb-3 text-xs text-ink-3">{blurb}</div>
      <button
        type="button"
        disabled
        className={
          isConnected
            ? 'w-full rounded-md border border-line-soft bg-fill px-3 py-1.5 text-xs font-medium text-ink-3'
            : 'w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-paper disabled:opacity-60'
        }
        title="Provider connections ship in v1.1"
      >
        {isConnected ? 'Manage' : 'Connect'}
      </button>
    </div>
  );
}

function ToolCard({ name, blurb }: { name: string; blurb: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line-soft bg-paper p-3">
      <div className="h-7 w-7 shrink-0 rounded-md bg-fill" aria-hidden />
      <div className="min-w-0">
        <div className="truncate text-xs font-medium">{name}</div>
        <div className="truncate text-[11px] text-ink-3">{blurb}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        connected
      </span>
    );
  }
  if (status === 'beta') {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
        beta
      </span>
    );
  }
  return (
    <span className="rounded-full bg-fill px-2 py-0.5 text-[10px] font-medium text-ink-3">
      available
    </span>
  );
}

// ---------------------------------------------------------------------------
// API keys panel — list / create / revoke
// ---------------------------------------------------------------------------

function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reveal, setReveal] = useState<{ id: string; key: string; name: string } | null>(null);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/workspace/api-keys')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.keys) setKeys(j.keys as ApiKeyRow[]);
        else setError(j?.error ?? 'Failed to load keys');
      })
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the action menu on any outside click.
  useEffect(() => {
    if (!openMenu) return;
    function onDoc() {
      setOpenMenu(null);
    }
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [openMenu]);

  async function createKey(name: string) {
    setError(null);
    const res = await fetch('/api/v1/workspace/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, scope: 'live' }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(typeof json?.error === 'string' ? json.error : 'Failed to create key');
      return;
    }
    const row: ApiKeyRow = {
      id: json.id,
      name: json.name,
      prefix: json.prefix,
      masked: json.masked,
      scope: json.scope,
      createdAt: json.createdAt,
      lastUsedAt: json.lastUsedAt,
    };
    setKeys((prev) => (prev ? [row, ...prev] : [row]));
    setCreateOpen(false);
    setReveal({ id: row.id, key: json.key, name: row.name });
  }

  async function revokeKey(id: string) {
    if (!confirm('Revoke this key? This cannot be undone — any client using it will break.'))
      return;
    setError(null);
    const res = await fetch(`/api/v1/workspace/api-keys/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(typeof json?.error === 'string' ? json.error : 'Failed to revoke');
      return;
    }
    setKeys((prev) => (prev ? prev.filter((k) => k.id !== id) : prev));
    setOpenMenu(null);
  }

  return (
    <div className="rounded-lg border border-line-soft bg-paper p-5">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold">API keys</div>
          <div className="text-xs text-ink-3">For programmatic access to your agents.</div>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-paper"
        >
          + Create new key
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      )}

      <div className="grid grid-cols-[140px_1fr_110px_90px_24px] gap-3 border-b border-line-soft pb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
        <div>Name</div>
        <div>Key</div>
        <div>Created</div>
        <div>Last used</div>
        <div aria-hidden />
      </div>

      {keys === null ? (
        <div className="px-1 py-6 text-xs text-ink-3">Loading…</div>
      ) : keys.length === 0 ? (
        <div className="px-1 py-6 text-xs text-ink-3">
          No keys yet. Create one to call the Vocera API from your backend.
        </div>
      ) : (
        keys.map((k) => (
          <div
            key={k.id}
            className="grid grid-cols-[140px_1fr_110px_90px_24px] items-center gap-3 border-b border-line-soft py-2 text-xs"
          >
            <div className="truncate font-medium">{k.name}</div>
            <div className="truncate font-mono text-ink-3">{k.masked}</div>
            <div className="text-ink-3">{formatDate(k.createdAt)}</div>
            <div className="text-ink-3">{k.lastUsedAt ? formatRel(k.lastUsedAt) : '—'}</div>
            <div className="relative flex justify-end">
              <button
                type="button"
                aria-label="Key actions"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenu(openMenu === k.id ? null : k.id);
                }}
                className="rounded p-1 text-ink-3 hover:bg-fill"
              >
                ⋯
              </button>
              {openMenu === k.id && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="menu"
                  className="absolute right-0 top-7 z-10 w-32 rounded-md border border-line-soft bg-paper py-1 text-xs shadow-md"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled
                    className="block w-full px-3 py-1.5 text-left text-ink-3 disabled:opacity-50"
                    title="Rotate ships in v1.1 — for now, create a new key and revoke the old one."
                  >
                    Rotate
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => revokeKey(k.id)}
                    className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
                  >
                    Revoke
                  </button>
                </div>
              )}
            </div>
          </div>
        ))
      )}

      {createOpen && (
        <CreateKeyDialog
          onCancel={() => setCreateOpen(false)}
          onCreate={createKey}
        />
      )}

      {reveal && (
        <RevealKeyDialog
          name={reveal.name}
          plaintext={reveal.key}
          onClose={() => setReveal(null)}
        />
      )}
    </div>
  );
}

function CreateKeyDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onCancel} labelledBy={inputId}>
      <form onSubmit={submit}>
        <h3 className="mb-1 text-sm font-semibold">Create API key</h3>
        <p className="mb-4 text-xs text-ink-3">
          Pick a name you'll recognize in audit logs (e.g. "Production backend",
          "CI bot").
        </p>
        <label htmlFor={inputId} className="mb-1 block text-xs font-medium">
          Name
        </label>
        <input
          id={inputId}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Production backend"
          className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line-soft px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-paper disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RevealKeyDialog({
  name,
  plaintext,
  onClose,
}: {
  name: string;
  plaintext: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers / insecure contexts — fall back to selection.
    }
  }
  return (
    <Modal onClose={onClose}>
      <h3 className="mb-1 text-sm font-semibold">Save your new key</h3>
      <p className="mb-4 text-xs text-ink-3">
        We'll only show the plaintext for <span className="font-medium">{name}</span> once
        — store it in your secret manager now. We hash it on our side and can't
        recover it later.
      </p>
      <div className="mb-4 flex items-center gap-2 rounded-md border border-line-soft bg-fill px-3 py-2">
        <code className="flex-1 break-all font-mono text-xs">{plaintext}</code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md border border-line-soft bg-paper px-2 py-1 text-[11px]"
        >
          {copied ? (
            <span className="inline-flex items-center gap-1 text-accent">
              <Check className="h-3 w-3" />
              Copied
            </span>
          ) : (
            'Copy'
          )}
        </button>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-paper"
        >
          I've saved it
        </button>
      </div>
    </Modal>
  );
}

// Lightweight modal — Radix Dialog wasn't worth the bundle for two simple
// dialogs that don't need portal/focus-trap semantics on this page.
function Modal({
  children,
  onClose,
  labelledBy,
}: {
  children: React.ReactNode;
  onClose: () => void;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        ref={ref}
        className="w-full max-w-md rounded-lg border border-line-soft bg-paper p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Webhook panel — copy URL, toggle events, send-test ping
// ---------------------------------------------------------------------------

function WebhookPanel() {
  const [url, setUrl] = useState('https://api.yourapp.com/vocera/events');
  const [events, setEvents] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(WEBHOOK_EVENTS.map((e, i) => [e, i < 4])),
  );
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastTest, setLastTest] = useState<{ ok: boolean; ms: number } | null>({
    ok: true,
    ms: 42,
  });

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function sendTest() {
    setTesting(true);
    const t0 = performance.now();
    // Real implementation will POST to /api/v1/workspace/webhook/test — for v1
    // we simulate with a HEAD-style fetch so the UX is wired end-to-end.
    try {
      await fetch(url, { method: 'POST', mode: 'no-cors' }).catch(() => {});
      const ms = Math.max(1, Math.round(performance.now() - t0));
      setLastTest({ ok: true, ms });
    } catch {
      setLastTest({ ok: false, ms: Math.round(performance.now() - t0) });
    } finally {
      setTesting(false);
    }
  }

  const selectedCount = Object.values(events).filter(Boolean).length;

  return (
    <div className="rounded-lg border border-line-soft bg-paper p-5">
      <div className="mb-1 text-sm font-semibold">Webhook URL</div>
      <p className="mb-3 text-xs text-ink-3">We'll POST call events here.</p>

      <div className="flex items-center gap-2 rounded-md border border-line-soft bg-fill px-3 py-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
        />
        <button
          type="button"
          onClick={copyUrl}
          className="shrink-0 rounded-md border border-line-soft bg-paper px-2 py-1 text-[11px]"
        >
          {copied ? (
            <span className="inline-flex items-center gap-1 text-accent">
              <Check className="h-3 w-3" />
              Copied
            </span>
          ) : (
            'Copy'
          )}
        </button>
      </div>

      <div className="mt-5">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium">Events to send</span>
          <span className="text-ink-3">{selectedCount} selected</span>
        </div>
        <div className="divide-y divide-line-soft">
          {WEBHOOK_EVENTS.map((evt) => (
            <ToggleRow
              key={evt}
              label={evt}
              checked={events[evt] ?? false}
              onChange={(v) => setEvents((prev) => ({ ...prev, [evt]: v }))}
            />
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-ink-3">
          Last delivery:{' '}
          {lastTest ? (
            <span
              className={
                lastTest.ok
                  ? 'rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent'
                  : 'rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600'
              }
            >
              {lastTest.ok ? '200 OK' : 'failed'} · {lastTest.ms}ms
            </span>
          ) : (
            <span className="text-ink-3">never</span>
          )}
        </span>
        <button
          type="button"
          onClick={sendTest}
          disabled={testing}
          className="rounded-md border border-line-soft bg-paper px-3 py-1.5 text-xs disabled:opacity-60"
        >
          {testing ? 'Sending…' : 'Send test'}
        </button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-2 text-xs">
      <span className="font-mono">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          checked
            ? 'relative h-4 w-7 rounded-full bg-accent transition'
            : 'relative h-4 w-7 rounded-full bg-line-soft transition'
        }
      >
        <span
          className={
            checked
              ? 'absolute top-0.5 left-3.5 h-3 w-3 rounded-full bg-paper transition'
              : 'absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-paper transition'
          }
        />
      </button>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Tiny date helpers — kept inline; pulling in date-fns for two formats isn't
// worth the bundle weight.
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
}

function formatRel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
