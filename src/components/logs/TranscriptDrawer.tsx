'use client';

/**
 * Call-logs client island.
 *
 * Exports two pieces:
 *   - <LogsView/>           — filterable table + drawer state. Used by the
 *                             server-rendered logs/page.tsx.
 *   - <TranscriptDrawer/>   — fixed right-side panel that fetches a single
 *                             conversation's messages and renders chat-style.
 *
 * Hand-rolled drawer (no Radix dialog) so the page table behind it stays
 * interactive — clicking a different row just reloads the drawer.
 */
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

type Role = 'user' | 'agent' | 'tool' | 'system';

type Message = {
  turnIndex: number;
  role: Role | string;
  content: string;
  language: string | null;
  toolName: string | null;
  ttftMs: number | null;
  createdAt: string;
};

type Conversation = {
  id: number;
  externalId: string;
  channel: string;
  direction: string | null;
  callerId: string | null;
  callerName: string | null;
  status: string;
  durationMs: number | null;
  intent: string | null;
  sentiment: string | null;
  detectedLanguages: string[] | null;
  startedAt: string;
  endedAt: string | null;
  agentName: string;
  agentExternalId: string;
};

type TranscriptResponse = {
  conversation: Conversation;
  messages: Message[];
};

type Tab = 'audio' | 'transcript' | 'flag';

export type LogRowSummary = {
  externalId: string;
  callerLabel: string;
  agentName: string;
  durationLabel: string;
};

interface Props {
  open: boolean;
  row: LogRowSummary | null;
  onClose: () => void;
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function turnTimestamp(startedAt: string, msgIso: string): string {
  const delta = Math.max(
    0,
    Math.floor((new Date(msgIso).getTime() - new Date(startedAt).getTime()) / 1000),
  );
  const m = Math.floor(delta / 60);
  const s = delta % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function TranscriptDrawer({ open, row, onClose }: Props) {
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('transcript');

  useEffect(() => {
    if (!open || !row) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setTab('transcript');

    fetch(`/api/v1/conversations/${encodeURIComponent(row.externalId)}/transcript`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as TranscriptResponse;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, row]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !row) return null;

  const conv = data?.conversation;
  const headerCaller = conv?.callerName || conv?.callerId || row.callerLabel;
  const agentName = conv?.agentName ?? row.agentName;
  const duration = conv ? formatDuration(conv.durationMs) : row.durationLabel;
  const startedRel = conv ? relativeTime(conv.startedAt) : '';

  return (
    <>
      {/* Overlay — soft, non-blocking visual cue. Click closes. */}
      <div
        className="fixed inset-0 z-30 bg-ink/5"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={`Transcript for ${headerCaller}`}
        className="fixed inset-y-0 right-0 z-40 flex w-[440px] flex-col border-l border-line-softer bg-paper shadow-token"
      >
        {/* Header */}
        <div className="border-b border-line-softer px-4 py-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-mono text-sm font-semibold">{headerCaller}</div>
              <div className="text-xs text-ink-3">
                {agentName}
                {conv?.intent ? <> · {conv.intent}</> : null}
                <> · {duration}</>
                {startedRel ? <> · {startedRel}</> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close transcript"
              className="rounded-md p-1 text-ink-3 hover:bg-fill hover:text-ink"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
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
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1.5">
            <TabBtn active={tab === 'audio'} onClick={() => setTab('audio')}>
              Play audio
            </TabBtn>
            <TabBtn active={tab === 'transcript'} onClick={() => setTab('transcript')}>
              Transcript
            </TabBtn>
            <TabBtn active={tab === 'flag'} onClick={() => setTab('flag')}>
              Flag
            </TabBtn>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-ink-3">Loading…</div>
          ) : error ? (
            <div className="px-4 py-8 text-center text-xs text-err">Failed: {error}</div>
          ) : !data ? (
            <div className="px-4 py-8 text-center text-xs text-ink-3">No data.</div>
          ) : tab === 'audio' ? (
            <AudioTab conv={data.conversation} />
          ) : tab === 'flag' ? (
            <FlagTab />
          ) : (
            <TranscriptTab conv={data.conversation} messages={data.messages} />
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-line-softer bg-fill/40 px-4 py-3">
          <button
            type="button"
            className="rounded-md border border-line-soft bg-paper px-3 py-1.5 text-xs text-ink hover:bg-fill"
          >
            Push to CRM
          </button>
          <button
            type="button"
            className="rounded-md border border-line-soft bg-paper px-3 py-1.5 text-xs text-ink hover:bg-fill"
          >
            Export
          </button>
        </div>
      </aside>
    </>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs transition',
        active
          ? 'border-accent/40 bg-accent-soft text-accent'
          : 'border-line-soft bg-paper text-ink-2 hover:bg-fill',
      )}
    >
      {children}
    </button>
  );
}

function AudioTab({ conv }: { conv: Conversation }) {
  const hasAudio = false; // wired up when audio storage lands
  return (
    <div className="px-4 py-6 text-xs text-ink-3">
      {hasAudio ? (
        <audio controls className="w-full" />
      ) : (
        <div className="rounded-md border border-dashed border-line-soft bg-fill/30 px-4 py-6 text-center">
          Audio recording not stored for this call ({formatDuration(conv.durationMs)}).
        </div>
      )}
    </div>
  );
}

function FlagTab() {
  return (
    <div className="space-y-3 px-4 py-4 text-xs text-ink-2">
      <div className="text-sm font-medium text-ink">Flag this conversation</div>
      <p className="text-ink-3">
        Tag the call so it shows up in the QA queue. Flags are visible to your
        workspace teammates.
      </p>
      <div className="flex flex-wrap gap-2">
        {['hallucination', 'rude tone', 'tool error', 'missed handoff', 'other'].map(
          (label) => (
            <button
              key={label}
              type="button"
              className="rounded-full border border-line-soft bg-paper px-3 py-1 text-xs text-ink-2 hover:bg-fill"
            >
              {label}
            </button>
          ),
        )}
      </div>
      <textarea
        rows={4}
        placeholder="Optional notes…"
        className="mt-2 w-full resize-none rounded-md border border-line-soft bg-paper px-3 py-2 text-xs text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90"
      >
        Submit flag
      </button>
    </div>
  );
}

function TranscriptTab({
  conv,
  messages,
}: {
  conv: Conversation;
  messages: Message[];
}) {
  if (messages.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs text-ink-3">
        No transcript captured for this conversation.
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      {/* AI summary block — best effort, populated from intent/sentiment */}
      {(conv.intent || conv.sentiment) && (
        <div className="mb-4 rounded-md border border-line-softer bg-fill/60 px-3 py-2.5">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-3">
            Summary
          </div>
          <div className="flex flex-wrap gap-1.5">
            {conv.intent && (
              <span className="rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
                intent: {conv.intent}
              </span>
            )}
            {conv.sentiment && (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px]',
                  conv.sentiment === 'positive'
                    ? 'border-ok/30 bg-ok/10 text-ok'
                    : conv.sentiment === 'negative'
                      ? 'border-err/30 bg-err/10 text-err'
                      : 'border-line-soft bg-paper text-ink-3',
                )}
              >
                sentiment: {conv.sentiment}
              </span>
            )}
            {(conv.detectedLanguages ?? []).slice(0, 3).map((lang) => (
              <span
                key={lang}
                className="rounded-full border border-line-soft bg-paper px-2 py-0.5 text-[11px] text-ink-3"
              >
                {lang}
              </span>
            ))}
          </div>
        </div>
      )}

      {messages.map((m) => {
        const ts = turnTimestamp(conv.startedAt, m.createdAt);

        if (m.role === 'tool' || m.role === 'tool_call') {
          return (
            <div
              key={m.turnIndex}
              className="my-2 rounded-md border-l-2 border-accent bg-fill/60 px-3 py-2 font-mono text-[11px] leading-snug text-ink-3"
            >
              <span className="text-ink-4">[{ts}]</span>{' '}
              <span className="text-ink-2">
                {m.toolName ? `${m.toolName}()` : 'tool'}
              </span>{' '}
              → {m.content}
            </div>
          );
        }

        if (m.role === 'system') {
          return (
            <div
              key={m.turnIndex}
              className="my-2 px-1 text-center text-[10px] uppercase tracking-wider text-ink-4"
            >
              {m.content}
            </div>
          );
        }

        const isAgent = m.role === 'agent' || m.role === 'assistant';
        return (
          <div
            key={m.turnIndex}
            className={cn(
              'mb-2.5 flex gap-2',
              isAgent ? 'flex-row' : 'flex-row-reverse',
            )}
          >
            <div
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                isAgent ? 'bg-accent text-paper' : 'bg-fill-2 text-ink',
              )}
              aria-hidden
            >
              {isAgent ? 'A' : 'U'}
            </div>
            <div className="max-w-[80%]">
              <div className="mb-0.5 text-[10px] uppercase tracking-wider text-ink-4">
                {isAgent ? 'Agent' : 'User'}
                {m.language ? ` · ${m.language}` : ''}
                {typeof m.ttftMs === 'number' && m.ttftMs > 0
                  ? ` · ${m.ttftMs}ms`
                  : ''}
              </div>
              <div
                className={cn(
                  'px-3 py-2 text-[12.5px] leading-snug',
                  isAgent
                    ? 'rounded-[10px_10px_10px_2px] bg-accent-soft text-ink'
                    : 'rounded-[10px_10px_2px_10px] bg-fill text-ink',
                )}
              >
                {m.content}
              </div>
              <div
                className={cn(
                  'mt-0.5 text-[10px] text-ink-4',
                  isAgent ? 'text-left' : 'text-right',
                )}
              >
                {ts}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ===================================================================== */
/*  LogsView — table + filters + drawer state                           */
/* ===================================================================== */

export type LogRow = {
  externalId: string;
  callerLabel: string;
  agentName: string;
  agentExternalId: string;
  intent: string | null;
  sentiment: string | null;
  channel: string;
  status: string;
  durationMs: number | null;
  languages: string[];
  startedAt: string; // ISO
};

type StatusFilter = 'all' | 'completed' | 'escalated' | 'missed' | 'failed';
type SentimentFilter = 'any' | 'positive' | 'neutral' | 'negative';

interface LogsViewProps {
  rows: LogRow[];
  agentNames: string[];
}

export function LogsView({ rows, agentNames }: LogsViewProps) {
  const [search, setSearch] = useState('');
  const [agent, setAgent] = useState<string>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sentiment, setSentiment] = useState<SentimentFilter>('any');
  const [selected, setSelected] = useState<LogRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (agent !== 'all' && r.agentName !== agent) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (sentiment !== 'any' && (r.sentiment ?? 'neutral') !== sentiment) return false;
      if (!q) return true;
      const haystack = [
        r.callerLabel,
        r.agentName,
        r.intent ?? '',
        r.status,
        r.channel,
        r.externalId,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, agent, status, sentiment]);

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <FilterBar
          search={search}
          onSearch={setSearch}
          agent={agent}
          onAgent={setAgent}
          agentNames={agentNames}
          status={status}
          onStatus={setStatus}
          sentiment={sentiment}
          onSentiment={setSentiment}
        />

        <div className="flex-1 overflow-auto px-6 pb-6">
          <div className="overflow-hidden rounded-lg border border-line-soft bg-paper shadow-token-sm">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-fill text-left text-[11px] uppercase tracking-wider text-ink-3">
                  <th className="px-4 py-2.5 font-medium">Caller</th>
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">Intent</th>
                  <th className="px-4 py-2.5 font-medium">Duration</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-ink-3"
                    >
                      {rows.length === 0
                        ? 'No conversations yet. Click "Talk to agent" on an agent to test.'
                        : 'No calls match your filters.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const isSel = selected?.externalId === r.externalId;
                    return (
                      <tr
                        key={r.externalId}
                        onClick={() => setSelected(r)}
                        className={cn(
                          'cursor-pointer border-t border-line-softer transition',
                          isSel ? 'bg-accent-soft' : 'hover:bg-fill',
                        )}
                      >
                        <td className="px-4 py-2.5 font-mono text-ink">
                          {r.callerLabel}
                        </td>
                        <td className="px-4 py-2.5 text-ink-2">{r.agentName}</td>
                        <td className="px-4 py-2.5">
                          {r.intent ? (
                            <span className="rounded-full border border-line-soft bg-paper px-2 py-0.5 text-[10.5px] text-ink-2">
                              {r.intent}
                            </span>
                          ) : (
                            <span className="text-ink-4">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-ink-2">
                          {formatDuration(r.durationMs)}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusPill status={r.status} />
                        </td>
                        <td className="px-4 py-2.5 text-ink-3" suppressHydrationWarning>
                          {relativeTime(r.startedAt)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {filtered.length > 0 && (
              <div className="flex items-center justify-between border-t border-line-softer px-4 py-2.5 text-[11.5px] text-ink-3">
                <span>
                  Showing 1–{filtered.length} of {rows.length}
                </span>
                <span className="text-ink-4">Pagination coming soon</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <TranscriptDrawer
        open={selected !== null}
        row={
          selected
            ? {
                externalId: selected.externalId,
                callerLabel: selected.callerLabel,
                agentName: selected.agentName,
                durationLabel: formatDuration(selected.durationMs),
              }
            : null
        }
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'completed'
      ? 'border-ok/30 bg-ok/10 text-ok'
      : status === 'escalated'
        ? 'border-warn/30 bg-warn/10 text-warn'
        : status === 'missed' || status === 'failed'
          ? 'border-err/30 bg-err/10 text-err'
          : 'border-line-soft bg-paper text-ink-3';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px]',
        tone,
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: 'currentColor' }}
      />
      {status}
    </span>
  );
}

interface FilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  agent: string;
  onAgent: (v: string) => void;
  agentNames: string[];
  status: StatusFilter;
  onStatus: (v: StatusFilter) => void;
  sentiment: SentimentFilter;
  onSentiment: (v: SentimentFilter) => void;
}

function FilterBar({
  search,
  onSearch,
  agent,
  onAgent,
  agentNames,
  status,
  onStatus,
  sentiment,
  onSentiment,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-4">
      <div className="flex w-full max-w-[280px] items-center gap-2 rounded-md border border-line-soft bg-paper px-2.5 py-1.5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-ink-3"
          aria-hidden
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by number, agent, intent…"
          className="w-full bg-transparent text-xs text-ink placeholder:text-ink-4 focus:outline-none"
        />
      </div>

      <FilterSelect
        value={agent}
        onChange={onAgent}
        label="Agent"
        options={[
          { value: 'all', label: 'All' },
          ...agentNames.map((n) => ({ value: n, label: n })),
        ]}
      />

      <FilterSelect
        value={status}
        onChange={(v) => onStatus(v as StatusFilter)}
        label="Status"
        options={[
          { value: 'all', label: 'All' },
          { value: 'completed', label: 'Completed' },
          { value: 'escalated', label: 'Escalated' },
          { value: 'missed', label: 'Missed' },
          { value: 'failed', label: 'Failed' },
        ]}
      />

      <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-[11px] text-accent">
        Last 7 days
      </span>

      <FilterSelect
        value={sentiment}
        onChange={(v) => onSentiment(v as SentimentFilter)}
        label="Sentiment"
        options={[
          { value: 'any', label: 'Any' },
          { value: 'positive', label: 'Positive' },
          { value: 'neutral', label: 'Neutral' },
          { value: 'negative', label: 'Negative' },
        ]}
      />
    </div>
  );
}

interface FilterSelectProps {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { value: string; label: string }[];
}

function FilterSelect({ value, onChange, label, options }: FilterSelectProps) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border border-line-soft bg-paper px-2.5 py-1 text-[11px] text-ink-3">
      <span>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer bg-transparent text-ink focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
