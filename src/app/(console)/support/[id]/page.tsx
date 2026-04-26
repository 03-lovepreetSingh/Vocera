'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Support deployment detail page.
 *
 * Two-column layout matching the voice setup shape:
 *   - Left rail: agent picker, drag-orderable lead fields, theme color,
 *     welcome message, position.
 *   - Right rail: a live, fake-browser preview of the chat widget. The
 *     preview has its own light/dark toggle that does NOT touch the global
 *     `<html data-theme>` — it's purely local.
 *
 * Below the preview lives the embed snippet card with a copy button.
 *
 * The deployments API for surface='support' is owned by the Voice Agents
 * track; this page consumes it via fetch and saves with PATCH. If the API
 * isn't live yet, the page still renders the live preview so the user can
 * iterate on visuals.
 */

type FieldKey =
  | 'name'
  | 'email'
  | 'account_id'
  | 'category'
  | 'description'
  | 'attachments';

type Field = {
  key: FieldKey;
  label: string;
  type: 'string' | 'email' | 'enum' | 'long-text' | 'file';
  required: boolean;
};

const DEFAULT_FIELDS: Field[] = [
  { key: 'name', label: 'Name', type: 'string', required: true },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'account_id', label: 'Account ID', type: 'string', required: false },
  { key: 'category', label: 'Issue category', type: 'enum', required: true },
  { key: 'description', label: 'Description', type: 'long-text', required: true },
  { key: 'attachments', label: 'Attachments', type: 'file', required: false },
];

const PRESET_COLORS = ['#0ea5a4', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a'];

type Position = 'bottom-right' | 'bottom-left';

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

type DeploymentResponse = {
  id?: string | number;
  externalId?: string;
  external_id?: string;
  agentId?: string;
  agent_id?: string;
  agentName?: string;
  agent_name?: string;
  agentExternalId?: string;
  agent_external_id?: string;
  themeColor?: string;
  theme_color?: string;
  position?: Position;
  welcomeMessage?: string;
  welcome_message?: string;
  fields?: Field[];
  config?: {
    fields?: Field[];
    themeColor?: string;
    welcomeMessage?: string;
    position?: Position;
  };
  deployment?: DeploymentResponse;
};

export default function SupportDeploymentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const deploymentId = params.id;

  // ---- form state -----------------------------------------------------------
  const [agentId, setAgentId] = useState<string>('');
  const [agentName, setAgentName] = useState<string>('');
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [fields, setFields] = useState<Field[]>(DEFAULT_FIELDS);
  const [themeColor, setThemeColor] = useState('#0ea5a4');
  const [welcomeMessage, setWelcomeMessage] = useState(
    "Hi! I'm here to help. What can I do?",
  );
  const [position, setPosition] = useState<Position>('bottom-right');

  // ---- meta state -----------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light');
  const [copied, setCopied] = useState(false);

  // ---- load deployment + agents --------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [depRes, agentsRes] = await Promise.all([
          fetch(`/api/v1/deployments/${encodeURIComponent(deploymentId)}`, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          }).catch(() => null),
          fetch('/api/v1/agents', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          }).catch(() => null),
        ]);

        if (agentsRes && agentsRes.ok) {
          const json = (await agentsRes.json()) as
            | { agents?: AgentApiRow[] }
            | AgentApiRow[];
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
          if (!cancelled) setAgents(normalised);
        }

        if (depRes && depRes.ok) {
          const raw = (await depRes.json()) as DeploymentResponse;
          const dep = raw.deployment ?? raw;
          if (!cancelled) {
            const aid = dep.agentExternalId ?? dep.agent_external_id ?? dep.agentId ?? dep.agent_id ?? '';
            setAgentId(String(aid));
            setAgentName(dep.agentName ?? dep.agent_name ?? '');
            const cfg = dep.config ?? {};
            const tc = dep.themeColor ?? dep.theme_color ?? cfg.themeColor;
            const wm = dep.welcomeMessage ?? dep.welcome_message ?? cfg.welcomeMessage;
            const pos = dep.position ?? cfg.position;
            const f = dep.fields ?? cfg.fields;
            if (tc) setThemeColor(tc);
            if (wm) setWelcomeMessage(wm);
            if (pos === 'bottom-left' || pos === 'bottom-right') setPosition(pos);
            if (Array.isArray(f) && f.length) setFields(f);
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[support/detail] failed to load', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deploymentId]);

  // Resolve a display name for the picker even if the API didn't ship one.
  useEffect(() => {
    if (!agentId) return;
    const match = agents.find((a) => a.externalId === agentId);
    if (match && match.name !== agentName) setAgentName(match.name);
  }, [agentId, agents, agentName]);

  // ---- drag reorder ---------------------------------------------------------
  const dragIdx = useRef<number | null>(null);

  function onDragStart(idx: number) {
    return () => {
      dragIdx.current = idx;
    };
  }
  function onDragOver(idx: number) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      const from = dragIdx.current;
      if (from === null || from === idx) return;
      setFields((prev) => {
        const next = prev.slice();
        const [moved] = next.splice(from, 1);
        next.splice(idx, 0, moved);
        return next;
      });
      dragIdx.current = idx;
    };
  }
  function onDragEnd() {
    dragIdx.current = null;
  }

  function toggleRequired(key: FieldKey) {
    setFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, required: !f.required } : f)),
    );
  }

  // ---- save -----------------------------------------------------------------
  async function handleSave() {
    setSaveState('saving');
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/v1/deployments/${encodeURIComponent(deploymentId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            surface: 'support',
            agent_id: agentId,
            theme_color: themeColor,
            welcome_message: welcomeMessage,
            position,
            fields,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `HTTP ${res.status}`);
      }
      setSaveState('saved');
      // Auto-clear the "saved" pill after a moment so future edits feel fresh.
      window.setTimeout(() => setSaveState('idle'), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
      setSaveState('error');
    }
  }

  // ---- embed snippet --------------------------------------------------------
  const embedSnippet = useMemo(
    () =>
      `<script src="/widget.js" data-agent="${agentId || 'ag_xxx'}" defer></script>`,
    [agentId],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can fail in non-secure contexts; users can still select-all manually.
    }
  }

  // ---- render ---------------------------------------------------------------
  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-line-soft bg-paper px-6">
        <h1 className="text-sm font-semibold">
          <Link href="/support" className="text-ink-3 hover:text-ink">
            Support Agents
          </Link>
          <span className="mx-2 text-ink-4">/</span>
          {agentName || 'Deployment'}
        </h1>
        <div className="flex items-center gap-2">
          {saveState === 'saved' ? (
            <span className="text-xs text-ok">Saved</span>
          ) : null}
          {saveState === 'error' ? (
            <span className="text-xs text-err" title={saveError ?? ''}>
              Couldn't save
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === 'saving' || loading}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-50"
          >
            {saveState === 'saving' ? 'Saving…' : 'Save & deploy'}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto px-6 py-6">
        <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          {/* ───────────────────── LEFT RAIL ───────────────────── */}
          <section className="flex flex-col gap-5">
            <Card title="Select AI agent" subtitle="The agent answering chats from this widget.">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAgentPickerOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-md border border-line-soft bg-paper px-3 py-2.5 text-left hover:bg-fill"
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent"
                      aria-hidden
                    >
                      <BotIcon />
                    </span>
                    <span>
                      <span className="block text-sm font-medium">
                        {agentName || (agentId ? agentId : 'Select an agent')}
                      </span>
                      <span className="block text-xs text-ink-3">
                        {agents.find((a) => a.externalId === agentId)?.purpose ?? '—'}
                      </span>
                    </span>
                  </span>
                  <ChevronIcon />
                </button>
                {agentPickerOpen ? (
                  <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line-soft bg-paper shadow-token">
                    {agents.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-ink-3">
                        No agents found. <Link href="/agents/new" className="text-accent">Create one</Link>.
                      </div>
                    ) : (
                      <ul>
                        {agents.map((a) => (
                          <li key={a.externalId}>
                            <button
                              type="button"
                              onClick={() => {
                                setAgentId(a.externalId);
                                setAgentName(a.name);
                                setAgentPickerOpen(false);
                              }}
                              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-fill ${
                                a.externalId === agentId ? 'bg-accent-soft' : ''
                              }`}
                            >
                              <span>
                                <span className="block font-medium">{a.name}</span>
                                <span className="block text-xs text-ink-3">
                                  {a.purpose} · v{a.currentVersion}
                                </span>
                              </span>
                              {a.externalId === agentId ? (
                                <span className="text-xs text-accent">Selected</span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            </Card>

            <Card
              title="Information to collect"
              subtitle="Drag to reorder. Toggle whether each field is required."
            >
              <ul className="grid gap-1">
                {fields.map((f, idx) => (
                  <li
                    key={f.key}
                    draggable
                    onDragStart={onDragStart(idx)}
                    onDragOver={onDragOver(idx)}
                    onDragEnd={onDragEnd}
                    className="grid cursor-grab items-center gap-3 rounded-md border border-line-softer bg-paper px-3 py-2 active:cursor-grabbing"
                    style={{ gridTemplateColumns: '20px 1fr 110px 90px' }}
                  >
                    <DragHandle />
                    <span className="text-sm font-medium">{f.label}</span>
                    <span className="rounded-sm border border-line-softer bg-fill px-2 py-0.5 text-center text-[10px] uppercase tracking-wide text-ink-3">
                      {f.type}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleRequired(f.key)}
                      className={`rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        f.required
                          ? 'bg-accent-soft text-accent'
                          : 'border border-line-softer bg-paper text-ink-3'
                      }`}
                    >
                      {f.required ? 'required' : 'optional'}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Theme color" subtitle="Used for the widget header and outgoing messages.">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                  className="h-10 w-12 cursor-pointer rounded-md border border-line-soft bg-paper p-1"
                  aria-label="Theme color"
                />
                <input
                  type="text"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                  className="w-28 rounded-md border border-line-soft bg-paper px-2.5 py-1.5 font-mono text-xs"
                  spellCheck={false}
                />
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setThemeColor(c)}
                      className={`h-6 w-6 rounded-md border transition ${
                        c.toLowerCase() === themeColor.toLowerCase()
                          ? 'ring-2 ring-offset-1 ring-offset-paper'
                          : 'border-line-soft'
                      }`}
                      style={{ background: c, borderColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            </Card>

            <Card title="Welcome message" subtitle="The first thing visitors see when they open the widget.">
              <textarea
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                rows={2}
                maxLength={240}
                className="w-full resize-none rounded-md border border-line-soft bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <div className="mt-1 text-right text-[10px] text-ink-3">
                {welcomeMessage.length} / 240
              </div>
            </Card>

            <Card title="Position" subtitle="Where the widget docks on the page.">
              <div className="grid grid-cols-2 gap-2">
                {(['bottom-right', 'bottom-left'] as Position[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPosition(p)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2.5 text-sm transition ${
                      position === p
                        ? 'border-accent bg-accent-soft'
                        : 'border-line-soft bg-paper hover:bg-fill'
                    }`}
                  >
                    <span className="capitalize">{p.replace('-', ' ')}</span>
                    <span className="relative h-6 w-10 rounded-sm border border-line-softer bg-fill">
                      <span
                        className="absolute h-2 w-2 rounded-sm"
                        style={{
                          background: themeColor,
                          bottom: 2,
                          left: p === 'bottom-left' ? 2 : undefined,
                          right: p === 'bottom-right' ? 2 : undefined,
                        }}
                      />
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          </section>

          {/* ───────────────────── RIGHT RAIL ───────────────────── */}
          <section className="flex flex-col gap-5">
            <div className="rounded-lg border border-line-soft bg-paper px-5 py-4 shadow-token-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold">Live preview</div>
                <ThemePill value={previewTheme} onChange={setPreviewTheme} />
              </div>
              <WidgetPreview
                themeColor={themeColor}
                welcomeMessage={welcomeMessage}
                position={position}
                agentName={agentName || 'Support'}
                previewTheme={previewTheme}
              />
            </div>

            <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
              <div className="mb-2 text-sm font-semibold">Embed snippet</div>
              <p className="mb-3 text-xs text-ink-3">
                Drop this script tag into your site (just before <code className="font-mono">{'</body>'}</code>).
              </p>
              <pre className="overflow-x-auto rounded-md bg-[#0b0d10] px-3 py-3 font-mono text-[11px] leading-relaxed text-[#86efac]">
                {embedSnippet}
              </pre>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-md border border-line-soft bg-paper px-3 py-1.5 text-xs hover:bg-fill"
                >
                  {copied ? 'Copied!' : 'Copy snippet'}
                </button>
                <span className="text-[11px] text-ink-3">
                  Widget runtime ships separately.
                </span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

// ───────────────────── helpers ─────────────────────

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
      <div className="mb-3">
        <div className="text-sm font-semibold">{title}</div>
        {subtitle ? <div className="mt-0.5 text-xs text-ink-3">{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}

function ThemePill({
  value,
  onChange,
}: {
  value: 'light' | 'dark';
  onChange: (v: 'light' | 'dark') => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-line-softer bg-fill p-0.5">
      {(['light', 'dark'] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize transition ${
            value === opt ? 'bg-paper text-ink shadow-token-sm' : 'text-ink-3'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function WidgetPreview({
  themeColor,
  welcomeMessage,
  position,
  agentName,
  previewTheme,
}: {
  themeColor: string;
  welcomeMessage: string;
  position: Position;
  agentName: string;
  previewTheme: 'light' | 'dark';
}) {
  // Local-only theme: never mutate global <html data-theme>. The values below
  // mirror the design tokens but stay scoped to this preview.
  const dark = previewTheme === 'dark';
  const pageBg = dark ? '#0f1115' : '#fafafa';
  const chromeBg = dark ? '#1c1f25' : '#ececec';
  const chromeBorder = dark ? '#2a2f36' : '#d1d5db';
  const skeletonStrong = dark ? '#3a3f47' : '#d1d5db';
  const skeletonSoft = dark ? '#2a2f36' : '#e5e7eb';
  const widgetBg = dark ? '#15181d' : '#ffffff';
  const widgetBorder = dark ? '#2a2f36' : 'rgba(0,0,0,0.06)';
  const incomingBg = dark ? '#1f242b' : '#f3f4f6';
  const incomingText = dark ? '#e5e7eb' : '#111827';
  const inputBg = dark ? '#1f242b' : '#f3f4f6';
  const inputText = dark ? '#9aa1ab' : '#9ca3af';
  const headerText = readableTextOn(themeColor);

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-line-softer"
      style={{ background: pageBg, height: 480 }}
    >
      {/* Fake browser chrome */}
      <div
        className="flex h-7 items-center gap-1.5 px-2"
        style={{ background: chromeBg, borderBottom: `1px solid ${chromeBorder}` }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: '#ef4444' }} />
        <span className="h-2 w-2 rounded-full" style={{ background: '#f59e0b' }} />
        <span className="h-2 w-2 rounded-full" style={{ background: '#10b981' }} />
        <span
          className="ml-3 flex-1 rounded-sm px-2 py-0.5 text-[10px]"
          style={{
            background: dark ? '#0f1115' : '#fff',
            color: dark ? '#9aa1ab' : '#9ca3af',
          }}
        >
          your-app.com
        </span>
      </div>

      {/* Skeleton page content */}
      <div className="px-4 py-3" style={{ opacity: 0.55 }}>
        <div
          className="mb-2.5 h-2 rounded-sm"
          style={{ background: skeletonStrong, width: '38%' }}
        />
        <div
          className="mb-1.5 h-1.5 rounded-sm"
          style={{ background: skeletonSoft, width: '90%' }}
        />
        <div
          className="mb-1.5 h-1.5 rounded-sm"
          style={{ background: skeletonSoft, width: '72%' }}
        />
        <div
          className="mb-4 h-1.5 rounded-sm"
          style={{ background: skeletonSoft, width: '85%' }}
        />
        <div
          className="mb-1.5 h-1.5 rounded-sm"
          style={{ background: skeletonSoft, width: '60%' }}
        />
        <div
          className="h-1.5 rounded-sm"
          style={{ background: skeletonSoft, width: '78%' }}
        />
      </div>

      {/* Widget */}
      <div
        className="absolute w-[300px] overflow-hidden rounded-xl"
        style={{
          [position === 'bottom-right' ? 'right' : 'left']: 14,
          bottom: 14,
          background: widgetBg,
          border: `1px solid ${widgetBorder}`,
          boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
        }}
      >
        <div
          className="flex items-center gap-2 px-3.5 py-3"
          style={{ background: themeColor, color: headerText }}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{ background: 'rgba(0,0,0,0.18)' }}
          >
            <BotIcon size={12} />
          </span>
          <span>
            <span className="block text-[12.5px] font-semibold leading-tight">
              {agentName}
            </span>
            <span className="block text-[10.5px] leading-tight" style={{ opacity: 0.85 }}>
              ● Online · usually replies instantly
            </span>
          </span>
          <span className="ml-auto opacity-80">
            <CloseIcon />
          </span>
        </div>
        <div
          className="overflow-hidden px-3.5 py-3 text-[12px]"
          style={{ background: widgetBg, color: incomingText, height: 240 }}
        >
          <div
            className="mb-2 max-w-[85%] rounded-[10px_10px_10px_2px] px-2.5 py-2"
            style={{ background: incomingBg }}
          >
            {welcomeMessage || "Hi! How can I help?"}
          </div>
          <div
            className="mb-2 ml-auto max-w-[85%] rounded-[10px_10px_2px_10px] px-2.5 py-2"
            style={{
              background: hexWithAlpha(themeColor, 0.18),
              color: dark ? '#e5e7eb' : '#0b3a39',
            }}
          >
            My internet is slow at night.
          </div>
          <div
            className="max-w-[85%] rounded-[10px_10px_10px_2px] px-2.5 py-2"
            style={{ background: incomingBg }}
          >
            Got it — first, can I grab your name and account ID?
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 px-3 py-2"
          style={{ borderTop: `1px solid ${dark ? '#2a2f36' : '#e5e7eb'}` }}
        >
          <div
            className="flex-1 rounded-full px-2.5 py-1.5 text-[11px]"
            style={{ background: inputBg, color: inputText }}
          >
            Type your message…
          </div>
          <span style={{ color: themeColor }}>
            <ArrowIcon />
          </span>
        </div>
      </div>
    </div>
  );
}

// ───────────────────── inline icons ─────────────────────
// Local SVGs keep the preview self-contained — the global icon set already
// has Bot/etc but importing them here would inflate the client bundle for a
// preview-only need.

function BotIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-3"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function DragHandle() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="text-ink-4"
      aria-hidden
    >
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

// ───────────────────── color utilities ─────────────────────

/**
 * Pick a readable text color for the given background. Uses YIQ luma so that
 * mid-tones don't drift to the wrong side. Fallback: dark text.
 */
function readableTextOn(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return '#0b3a39';
  const yiq = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return yiq >= 160 ? '#0b3a39' : '#ffffff';
}

/** Compose an `rgba(r,g,b,a)` string from a hex color and alpha. */
function hexWithAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return `rgba(14, 165, 164, ${alpha})`;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0], 16);
    const g = parseInt(clean[1]! + clean[1], 16);
    const b = parseInt(clean[2]! + clean[2], 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return [r, g, b];
  }
  return null;
}
