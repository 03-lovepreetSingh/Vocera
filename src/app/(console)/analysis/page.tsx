/**
 * Analysis page — workspace-level rollup for the last 30 days.
 *
 * Pure server component. Interactive pieces (channel filter) are driven by URL
 * search params so we don't need a client island, keeping ownership of this
 * feature to the three files spec'd in the brief.
 *
 * Data shape mirrors /api/v1/analytics/overview and /api/v1/analytics/intents
 * — we compute here directly to skip the round-trip, but the API exists so
 * external dashboards can hit the same numbers.
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import Link from 'next/link';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { withWorkspace } from '@/db/client';
import { agents, conversations } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const DAYS = 30;
const LEADS_LIMIT = 50;

type Channel = 'all' | 'voice' | 'support';

function parseChannel(v: string | undefined): Channel {
  if (v === 'voice' || v === 'support') return v;
  return 'all';
}

export default async function AnalysisPage(props: {
  searchParams: { channel?: string };
}) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const channel = parseChannel(props.searchParams.channel);

  const data = await withWorkspace(wsId, async (tx) => {
    // Per-day, per-channel counts. We always return both series so the chart
    // can show both regardless of which pill is selected (the pill controls
    // the leads table + headline numbers, the chart always shows both lines).
    const byDayRes = await tx.execute(sql`
      WITH days AS (
        SELECT generate_series(
          (now() at time zone 'utc')::date - (${DAYS - 1})::int,
          (now() at time zone 'utc')::date,
          '1 day'::interval
        )::date AS d
      )
      SELECT
        days.d::text AS date,
        COALESCE(SUM(CASE WHEN c.channel = 'voice'   THEN 1 ELSE 0 END), 0)::int AS voice,
        COALESCE(SUM(CASE WHEN c.channel = 'support' THEN 1 ELSE 0 END), 0)::int AS support
      FROM days
      LEFT JOIN conversations c
        ON (c.started_at at time zone 'utc')::date = days.d
      GROUP BY days.d
      ORDER BY days.d ASC
    `);

    const aggRes = await tx.execute(sql`
      SELECT
        COUNT(*)::int                                                    AS total,
        COALESCE(SUM(CASE WHEN channel = 'voice'   THEN 1 ELSE 0 END), 0)::int AS voice_total,
        COALESCE(SUM(CASE WHEN channel = 'support' THEN 1 ELSE 0 END), 0)::int AS support_total,
        COALESCE(SUM(CASE
          WHEN caller_name IS NOT NULL OR caller_id IS NOT NULL THEN 1 ELSE 0
        END), 0)::int                                                    AS leads,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)::int AS resolved,
        COALESCE(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), 0)::int AS avg_handle_ms
      FROM conversations
      WHERE started_at > now() - (${DAYS}::int || ' days')::interval
    `);

    const intentsRes = await tx.execute(sql`
      SELECT intent, COUNT(*)::int AS count
      FROM conversations
      WHERE intent IS NOT NULL
        AND intent <> ''
        AND started_at > now() - (${DAYS}::int || ' days')::interval
      GROUP BY intent
      ORDER BY count DESC
      LIMIT 5
    `);

    // Leads — most-recent conversations within the 30-day window, optionally
    // filtered to one channel. We use drizzle's typed builder here so the
    // column shape stays in sync with the schema.
    const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
    const conds = [eq(conversations.workspaceId, wsId), gt(conversations.startedAt, cutoff)];
    if (channel !== 'all') conds.push(eq(conversations.channel, channel));

    const leadRows = await tx
      .select({
        id: conversations.id,
        externalId: conversations.externalId,
        callerName: conversations.callerName,
        callerId: conversations.callerId,
        channel: conversations.channel,
        intent: conversations.intent,
        sentiment: conversations.sentiment,
        startedAt: conversations.startedAt,
        agentName: agents.name,
      })
      .from(conversations)
      .innerJoin(agents, eq(agents.id, conversations.agentId))
      .where(and(...conds))
      .orderBy(desc(conversations.startedAt))
      .limit(LEADS_LIMIT);

    return {
      byDay: (byDayRes.rows as Array<{ date: string; voice: number; support: number }>).map(
        (r) => ({ date: r.date, voice: Number(r.voice) || 0, support: Number(r.support) || 0 }),
      ),
      agg: (aggRes.rows[0] ?? {
        total: 0,
        voice_total: 0,
        support_total: 0,
        leads: 0,
        resolved: 0,
        avg_handle_ms: 0,
      }) as {
        total: number;
        voice_total: number;
        support_total: number;
        leads: number;
        resolved: number;
        avg_handle_ms: number;
      },
      intents: (intentsRes.rows as Array<{ intent: string; count: number }>).map((r) => ({
        intent: r.intent,
        count: Number(r.count) || 0,
      })),
      leads: leadRows,
    };
  });

  const total = Number(data.agg.total) || 0;
  const voiceTotal = Number(data.agg.voice_total) || 0;
  const supportTotal = Number(data.agg.support_total) || 0;
  const leadsCaptured = Number(data.agg.leads) || 0;
  const resolved = Number(data.agg.resolved) || 0;
  const avgHandleMs = Number(data.agg.avg_handle_ms) || 0;
  const resolvedPct = total === 0 ? 0 : Math.round((resolved / total) * 100);

  // Headline scoped to channel pill — keeps the cards meaningful when filtered.
  const scopedTotal =
    channel === 'voice' ? voiceTotal : channel === 'support' ? supportTotal : total;

  // Deltas: compare last 7 days vs the prior 7 days (within the byDay series).
  const last7 = data.byDay.slice(-7);
  const prev7 = data.byDay.slice(-14, -7);
  const sumChan = (arr: typeof data.byDay) =>
    arr.reduce(
      (a, r) =>
        a +
        (channel === 'voice'
          ? r.voice
          : channel === 'support'
            ? r.support
            : r.voice + r.support),
      0,
    );
  const last7Total = sumChan(last7);
  const prev7Total = sumChan(prev7);
  const convoDelta = pctDelta(last7Total, prev7Total);

  const isEmpty = total === 0 && data.leads.length === 0;

  return (
    <>
      <AppTopbar title="Analysis" />
      <main className="flex-1 overflow-auto px-6 py-6">
        {/* Channel toggle pills */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ChannelPill href="/analysis" label={`All channels · ${total.toLocaleString()}`} active={channel === 'all'} />
          <ChannelPill
            href="/analysis?channel=voice"
            label={`📞 Voice · ${voiceTotal.toLocaleString()}`}
            active={channel === 'voice'}
          />
          <ChannelPill
            href="/analysis?channel=support"
            label={`💬 Support · ${supportTotal.toLocaleString()}`}
            active={channel === 'support'}
          />
        </div>

        {isEmpty ? (
          <div className="rounded-lg border border-dashed border-line-soft bg-paper px-8 py-16 text-center">
            <h2 className="text-base font-semibold">No conversations yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
              Leads will show up here once your agents are talking.
            </p>
          </div>
        ) : (
          <>
            {/* Stats row */}
            <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Conversations"
                value={scopedTotal.toLocaleString()}
                delta={convoDelta}
              />
              <StatCard
                label="Leads captured"
                value={leadsCaptured.toLocaleString()}
                delta={null}
              />
              <StatCard label="Resolved" value={`${resolvedPct}%`} delta={null} />
              <StatCard
                label="Avg handle"
                value={formatDuration(avgHandleMs)}
                delta={null}
              />
            </section>

            {/* Two-up: stacked area chart + top intents */}
            <section className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="rounded-lg border border-line-soft bg-paper p-4 lg:col-span-2">
                <div className="mb-3 text-sm font-semibold">
                  Conversations · voice vs support
                </div>
                <StackedAreaChart data={data.byDay} />
                <div className="mt-2 flex items-center gap-4 text-xs text-ink-3">
                  <Legend color="var(--accent)" label="Voice" />
                  <Legend color="#60a5fa" label="Support widget" />
                </div>
              </div>
              <div className="rounded-lg border border-line-soft bg-paper p-4">
                <div className="mb-3 text-sm font-semibold">Top intents</div>
                {data.intents.length === 0 ? (
                  <p className="text-sm text-ink-3">No intents detected yet.</p>
                ) : (
                  <IntentBars intents={data.intents} />
                )}
              </div>
            </section>

            {/* Leads table */}
            <section className="rounded-lg border border-line-soft bg-paper">
              <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
                <div>
                  <div className="text-sm font-semibold">Captured leads &amp; insights</div>
                  <div className="text-xs text-ink-3">
                    Structured data extracted from each conversation.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-line-soft px-3 py-1.5 text-xs hover:bg-fill"
                  >
                    Push to CRM
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-line-soft px-3 py-1.5 text-xs hover:bg-fill"
                  >
                    Export CSV
                  </button>
                </div>
              </div>

              {/* Filter chips */}
              <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-5 py-3 text-xs text-ink-3">
                <span className="font-medium text-ink-2">Filter:</span>
                <FilterChip
                  href="/analysis"
                  label="All"
                  active={channel === 'all'}
                />
                <FilterChip
                  href="/analysis?channel=voice"
                  label="Voice"
                  active={channel === 'voice'}
                />
                <FilterChip
                  href="/analysis?channel=support"
                  label="Support"
                  active={channel === 'support'}
                />
              </div>

              {data.leads.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-ink-3">
                  No conversations match this filter yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-fill text-left text-xs uppercase text-ink-3">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Name</th>
                        <th className="px-4 py-2.5 font-medium">Contact</th>
                        <th className="px-4 py-2.5 font-medium">Channel</th>
                        <th className="px-4 py-2.5 font-medium">Issue</th>
                        <th className="px-4 py-2.5 font-medium">Inquiry</th>
                        <th className="px-4 py-2.5 font-medium">Urgency</th>
                        <th className="px-4 py-2.5 font-medium">Sentiment</th>
                        <th className="px-4 py-2.5 font-medium">Captured</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-soft">
                      {data.leads.map((r) => (
                        <tr key={r.id} className="hover:bg-fill/40">
                          <td className="px-4 py-2.5 font-medium">
                            {r.callerName ?? <span className="text-ink-3">Anonymous</span>}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs">
                            {r.callerId ?? <span className="text-ink-4">—</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            {r.channel === 'voice'
                              ? '📞 voice'
                              : r.channel === 'support'
                                ? '💬 support'
                                : r.channel}
                          </td>
                          <td className="px-4 py-2.5">
                            {r.intent ?? <span className="text-ink-4">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-ink-3">
                            <span className="text-ink-4">—</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <UrgencyTag urgency={inferUrgency(r.intent)} />
                          </td>
                          <td className="px-4 py-2.5 text-base leading-none">
                            {sentimentEmoji(r.sentiment)}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-ink-3">
                            {timeAgo(r.startedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

// ──────────────────────── small presentational helpers ────────────────────────

function ChannelPill({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line-soft bg-paper text-ink-3 hover:bg-fill',
      )}
    >
      {label}
    </Link>
  );
}

function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full border px-2.5 py-0.5 transition',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line-soft bg-paper hover:bg-fill',
      )}
    >
      {label}
    </Link>
  );
}

function StatCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: { pct: number; up: boolean } | null;
}) {
  return (
    <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {delta && (
          <span
            className={cn(
              'text-xs font-medium',
              delta.up ? 'text-ok' : 'text-err',
            )}
          >
            {delta.up ? '↑' : '↓'} {delta.pct}%
          </span>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function IntentBars({ intents }: { intents: { intent: string; count: number }[] }) {
  const max = Math.max(1, ...intents.map((i) => i.count));
  return (
    <ul className="space-y-2.5">
      {intents.map((i) => {
        const pct = Math.round((i.count / max) * 100);
        return (
          <li key={i.intent} className="text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="truncate" title={i.intent}>
                {i.intent}
              </span>
              <span className="font-mono text-ink-3">{i.count.toLocaleString()}</span>
            </div>
            <div className="h-1.5 rounded bg-line-softer">
              <div
                className="h-full rounded bg-accent"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Hand-rolled stacked area chart. SVG paths trace voice (bottom) and voice+support
 * (top), giving us two stacked layers without a chart library.
 *
 * Layout:
 *   - viewBox 600×180 (matches the design reference)
 *   - x is days (0 → byDay.length - 1) mapped to 0..600
 *   - y is conversations, scaled to a shared y-axis so the layers stack properly
 */
function StackedAreaChart({
  data,
}: {
  data: { date: string; voice: number; support: number }[];
}) {
  const W = 600;
  const H = 180;
  if (data.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full">
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--ink-3)" fontSize={12}>
          No data yet
        </text>
      </svg>
    );
  }

  // Stack: at each day, lower line = voice, upper line = voice + support.
  const stackedTotals = data.map((d) => d.voice + d.support);
  const maxY = Math.max(1, ...stackedTotals);

  const xAt = (i: number) =>
    data.length === 1 ? W / 2 : (i / (data.length - 1)) * W;
  const yAt = (v: number) => H - (v / maxY) * (H - 10) - 5; // 5px padding top/bottom

  // Voice area (anchored to baseline) — the "lower" stack layer.
  const voiceTopPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(d.voice)}`)
    .join(' ');
  const voiceArea = `${voiceTopPath} L ${xAt(data.length - 1)} ${H} L ${xAt(0)} ${H} Z`;

  // Support area (anchored on top of voice) — fills between voice line and total line.
  const totalTopPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(d.voice + d.support)}`)
    .join(' ');
  const voiceTopReverse = data
    .map((d, i) => `L ${xAt(data.length - 1 - i)} ${yAt(data[data.length - 1 - i].voice)}`)
    .join(' ');
  const supportArea = `${totalTopPath} ${voiceTopReverse} Z`;

  // Gridlines at 0, 25, 50, 75, 100% of H.
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => H * f);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-[180px] w-full"
    >
      {grid.map((y) => (
        <line
          key={y}
          x1={0}
          x2={W}
          y1={y}
          y2={y}
          stroke="var(--line-softer)"
          strokeDasharray="2 3"
        />
      ))}
      {/* Support stacked on top */}
      <path d={supportArea} fill="#60a5fa" fillOpacity={0.18} />
      <path
        d={totalTopPath}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={2}
        strokeDasharray="4 3"
      />
      {/* Voice underneath */}
      <path d={voiceArea} fill="var(--accent-soft)" />
      <path d={voiceTopPath} fill="none" stroke="var(--accent)" strokeWidth={2} />
    </svg>
  );
}

function UrgencyTag({ urgency }: { urgency: 'high' | 'med' | 'low' | null }) {
  if (!urgency) return <span className="text-ink-4">—</span>;
  const cls =
    urgency === 'high'
      ? 'border-err/30 bg-err/10 text-err'
      : urgency === 'med'
        ? 'border-warn/30 bg-warn/10 text-warn'
        : 'border-line-soft bg-fill text-ink-3';
  return (
    <span
      className={cn(
        'inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
        cls,
      )}
    >
      {urgency}
    </span>
  );
}

// ──────────────────────────────── pure utils ────────────────────────────────

function pctDelta(curr: number, prev: number): { pct: number; up: boolean } | null {
  if (prev === 0) {
    if (curr === 0) return null;
    return { pct: 100, up: true };
  }
  const raw = ((curr - prev) / prev) * 100;
  return { pct: Math.abs(Math.round(raw)), up: raw >= 0 };
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

/**
 * Best-effort sentiment-string → emoji mapping. The schema stores a free-form
 * `sentiment` string; we accept the common labels we'd expect from the LLM
 * (positive/neutral/negative/angry) and fall back to neutral when unknown.
 */
function sentimentEmoji(s: string | null): string {
  if (!s) return '😐';
  const v = s.toLowerCase();
  if (v.includes('angry') || v.includes('furious') || v.includes('mad')) return '😠';
  if (v.includes('neg') || v.includes('frustrat') || v.includes('upset')) return '😕';
  if (v.includes('pos') || v.includes('happy') || v.includes('satisf')) return '😊';
  return '😐';
}

/**
 * Cheap urgency heuristic from the intent string until we wire structured
 * extraction. Keeps the column visually populated and matches the design.
 */
function inferUrgency(intent: string | null): 'high' | 'med' | 'low' | null {
  if (!intent) return null;
  const v = intent.toLowerCase();
  if (
    v.includes('cancel') ||
    v.includes('refund') ||
    v.includes('outage') ||
    v.includes('urgent') ||
    v.includes('escalat')
  ) {
    return 'high';
  }
  if (
    v.includes('billing') ||
    v.includes('schedule') ||
    v.includes('technician') ||
    v.includes('troubleshoot')
  ) {
    return 'med';
  }
  return 'low';
}

function timeAgo(when: Date | string): string {
  const then = typeof when === 'string' ? new Date(when).getTime() : when.getTime();
  const diff = Date.now() - then;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
