/**
 * Billing dashboard.
 *
 * Layout (matches reference design `/tmp/design/test-1/project/v2-pages.jsx`,
 * BillingPage):
 *   1. Three top cards — Current bill (with feature stacked-bar), Plan +
 *      usage progress, Forecast with sparkline.
 *   2. Two side-by-side tables — cost-by-feature and cost-by-agent.
 *   3. 30-day daily-spend bar chart with average callout.
 *
 * Data is read in-process via `withWorkspace(...)` (same pattern as
 * /api/v1/analytics/overview and /src/app/(console)/agents/page.tsx). The REST
 * routes under /api/v1/billing/* exist for programmatic callers and share the
 * same shapes; we duplicate a small amount of SQL here to keep the SSR render
 * a single round-trip with no internal HTTP hop.
 *
 * Empty-state: when `usage_events` doesn't exist yet (or has no rows for the
 * workspace this month) we render a single zero-row in each table, matching
 * the spec.
 */
import { sql } from 'drizzle-orm';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { withWorkspace } from '@/db/client';
import { auth } from '@/server/auth/config';

type FeatureBucket = 'voice' | 'ai' | 'telephony' | 'kb' | 'other';

type BillingData = {
  rangeStart: string;
  rangeEnd: string;
  daysElapsed: number;
  daysInMonth: number;
  mtdCents: number;
  prevMonthCents: number;
  byFeature: Record<FeatureBucket, number>;
  byDay: { date: string; cents: number }[];
  forecastCents: number;
  featureRows: FeatureRow[];
  agentRows: AgentRow[];
};

type FeatureRow = {
  eventType: string;
  label: string;
  usage: number;
  unit: string;
  unitPriceCents: number;
  totalCents: number;
};

type AgentRow = {
  agentId: string;
  name: string;
  type: string;
  minutes: number;
  costCents: number;
  share: number;
};

const FEATURE_KEYS: FeatureBucket[] = ['voice', 'ai', 'telephony', 'kb', 'other'];
const FEATURE_LABEL: Record<FeatureBucket, string> = {
  voice: 'Voice',
  ai: 'AI',
  telephony: 'Telephony',
  kb: 'KB',
  other: 'Other',
};
// Hardcoded swatches (Tailwind palette) — kept as inline styles so we don't
// need to extend the theme just for the stacked bar / legend dots.
const FEATURE_COLOR: Record<FeatureBucket, string> = {
  voice: 'var(--accent)',
  ai: '#60a5fa',
  telephony: '#f59e0b',
  kb: '#a78bfa',
  other: 'var(--ink-4)',
};

function emptyBuckets(): Record<FeatureBucket, number> {
  return FEATURE_KEYS.reduce(
    (acc, k) => {
      acc[k] = 0;
      return acc;
    },
    {} as Record<FeatureBucket, number>,
  );
}

function bucketFor(eventType: string): FeatureBucket {
  const t = eventType.toLowerCase();
  if (t.startsWith('voice') || t === 'tts' || t === 'stt') return 'voice';
  if (t.startsWith('ai') || t === 'llm' || t === 'inference') return 'ai';
  if (t.startsWith('telephony') || t === 'twilio') return 'telephony';
  if (t.startsWith('kb') || t === 'knowledge' || t === 'storage') return 'kb';
  return 'other';
}

function describeEventType(eventType: string): { label: string; unit: string } {
  const t = eventType.toLowerCase();
  switch (t) {
    case 'voice_synthesis':
    case 'tts':
      return { label: 'Voice synthesis', unit: 'min' };
    case 'speech_to_text':
    case 'stt':
      return { label: 'Speech-to-text', unit: 'min' };
    case 'ai_inference':
    case 'llm':
    case 'inference':
      return { label: 'AI inference', unit: '1k tok' };
    case 'telephony':
    case 'twilio':
      return { label: 'Telephony', unit: 'min' };
    case 'kb_storage':
    case 'knowledge':
    case 'storage':
      return { label: 'Knowledge base', unit: 'storage' };
    case 'webhook':
    case 'webhooks':
    case 'api_request':
      return { label: 'Webhooks & API', unit: 'req' };
    default: {
      const pretty = eventType
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return { label: pretty, unit: '' };
    }
  }
}

function formatUSD(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatUSDShort(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString()}`;
}

function formatUnitPrice(cents: number, unit: string): string {
  if (cents <= 0) return '—';
  // Sub-cent rates (e.g. tokens, requests) need extra precision.
  const dollars = cents / 100;
  if (dollars < 0.01) return `$${dollars.toFixed(4)} / ${unit || 'unit'}`;
  return `$${dollars.toFixed(3)} / ${unit || 'unit'}`;
}

function formatUsage(usage: number, unit: string): string {
  if (usage <= 0) return '—';
  if (unit === '1k tok') {
    // We store quantity as raw tokens; display as compact M/K.
    if (usage >= 1_000_000) return `${(usage / 1_000_000).toFixed(1)}M tok`;
    if (usage >= 1_000) return `${(usage / 1_000).toFixed(1)}k tok`;
    return `${usage} tok`;
  }
  if (unit === 'req') {
    if (usage >= 1_000) return `${(usage / 1_000).toFixed(1)}k req`;
    return `${usage} req`;
  }
  if (unit === 'min') return `${Math.round(usage).toLocaleString()} min`;
  if (unit === 'storage') return '—';
  return `${Math.round(usage).toLocaleString()}`;
}

async function loadBillingData(wsId: number): Promise<BillingData> {
  return withWorkspace(wsId, async (tx) => {
    // Bounds + day counters in a single SQL statement.
    const boundsRes = await tx.execute(sql`
      SELECT
        date_trunc('month', now() at time zone 'utc')::date           AS range_start,
        ((date_trunc('month', now() at time zone 'utc')
          + interval '1 month' - interval '1 day')::date)             AS range_end,
        ((now() at time zone 'utc')::date
          - date_trunc('month', now() at time zone 'utc')::date + 1)::int AS days_elapsed,
        EXTRACT(
          DAY FROM (date_trunc('month', now() at time zone 'utc')
            + interval '1 month' - interval '1 day')
        )::int                                                        AS days_in_month
    `);
    const bounds = (boundsRes.rows[0] ?? {
      range_start: new Date().toISOString().slice(0, 10),
      range_end: new Date().toISOString().slice(0, 10),
      days_elapsed: 1,
      days_in_month: 30,
    }) as {
      range_start: string;
      range_end: string;
      days_elapsed: number;
      days_in_month: number;
    };
    const rangeStart = String(bounds.range_start);
    const rangeEnd = String(bounds.range_end);
    const daysElapsed = Math.max(1, Number(bounds.days_elapsed) || 1);
    const daysInMonth = Math.max(daysElapsed, Number(bounds.days_in_month) || 30);

    // Schema-tolerant: gracefully no-op if `usage_events` hasn't been migrated
    // in yet. The page still renders; tables show the empty-state row.
    const existsRes = await tx.execute(sql`SELECT to_regclass('public.usage_events') AS rel`);
    const hasTable =
      ((existsRes.rows[0] as { rel: string | null } | undefined)?.rel ?? null) !== null;

    if (!hasTable) {
      const byDay = Array.from({ length: daysElapsed }, (_, i) => {
        const d = new Date(`${rangeStart}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return { date: d.toISOString().slice(0, 10), cents: 0 };
      });
      return {
        rangeStart,
        rangeEnd,
        daysElapsed,
        daysInMonth,
        mtdCents: 0,
        prevMonthCents: 0,
        byFeature: emptyBuckets(),
        byDay,
        forecastCents: 0,
        featureRows: [],
        agentRows: [],
      };
    }

    // ── MTD aggregates ───────────────────────────────────────────────────
    const byTypeRes = await tx.execute(sql`
      SELECT event_type::text                              AS event_type,
             COALESCE(SUM(quantity), 0)::numeric           AS usage,
             COALESCE(SUM(price_cents), 0)::bigint         AS total_cents
      FROM usage_events
      WHERE occurred_at >= date_trunc('month', now() at time zone 'utc')
        AND occurred_at <  date_trunc('month', now() at time zone 'utc') + interval '1 month'
      GROUP BY event_type
      ORDER BY total_cents DESC
    `);

    const byFeature = emptyBuckets();
    let mtdCents = 0;
    const featureRows: FeatureRow[] = [];
    for (const r of byTypeRes.rows as Array<{
      event_type: string;
      usage: string | number;
      total_cents: string | number;
    }>) {
      const usage = Number(r.usage) || 0;
      const totalCents = Number(r.total_cents) || 0;
      mtdCents += totalCents;
      byFeature[bucketFor(r.event_type)] += totalCents;
      const { label, unit } = describeEventType(r.event_type);
      featureRows.push({
        eventType: r.event_type,
        label,
        usage,
        unit,
        unitPriceCents: usage > 0 ? totalCents / usage : 0,
        totalCents,
      });
    }

    // ── Previous calendar month (for the "↑ X% vs <prev>" callout) ───────
    const prevRes = await tx.execute(sql`
      SELECT COALESCE(SUM(price_cents), 0)::bigint AS cents
      FROM usage_events
      WHERE occurred_at >= date_trunc('month', now() at time zone 'utc') - interval '1 month'
        AND occurred_at <  date_trunc('month', now() at time zone 'utc')
    `);
    const prevMonthCents = Number(
      (prevRes.rows[0] as { cents: string | number } | undefined)?.cents ?? 0,
    );

    // ── Per-day spend, zero-filled ───────────────────────────────────────
    const byDayRes = await tx.execute(sql`
      WITH days AS (
        SELECT generate_series(
          date_trunc('month', now() at time zone 'utc')::date,
          (now() at time zone 'utc')::date,
          '1 day'::interval
        )::date AS d
      )
      SELECT days.d::text AS date,
             COALESCE(SUM(u.price_cents), 0)::bigint AS cents
      FROM days
      LEFT JOIN usage_events u
        ON (u.occurred_at at time zone 'utc')::date = days.d
      GROUP BY days.d
      ORDER BY days.d ASC
    `);
    const byDay = (byDayRes.rows as Array<{ date: string; cents: string | number }>).map((r) => ({
      date: String(r.date),
      cents: Number(r.cents) || 0,
    }));

    // ── Forecast (rolling 14-day avg × days remaining + MTD) ─────────────
    const trailingRes = await tx.execute(sql`
      SELECT COALESCE(SUM(price_cents), 0)::bigint AS cents
      FROM usage_events
      WHERE occurred_at >= (now() at time zone 'utc') - interval '14 days'
        AND occurred_at <  (now() at time zone 'utc')
    `);
    const trailing14 = Number(
      (trailingRes.rows[0] as { cents: string | number } | undefined)?.cents ?? 0,
    );
    const dailyAvg = trailing14 / 14;
    const daysRemaining = Math.max(0, daysInMonth - daysElapsed);
    const forecastCents = Math.round(mtdCents + dailyAvg * daysRemaining);

    // ── By agent ─────────────────────────────────────────────────────────
    const byAgentRes = await tx.execute(sql`
      SELECT
        a.external_id::text                                   AS agent_id,
        a.name::text                                          AS name,
        a.purpose::text                                       AS type,
        COALESCE(SUM(
          CASE
            WHEN u.event_type IN ('voice_synthesis','tts','speech_to_text','stt','telephony','twilio')
            THEN u.quantity ELSE 0
          END
        ), 0)::numeric                                        AS minutes,
        COALESCE(SUM(u.price_cents), 0)::bigint               AS cost_cents
      FROM usage_events u
      JOIN agents a ON a.id = u.agent_id
      WHERE u.occurred_at >= date_trunc('month', now() at time zone 'utc')
        AND u.occurred_at <  date_trunc('month', now() at time zone 'utc') + interval '1 month'
      GROUP BY a.external_id, a.name, a.purpose
      ORDER BY cost_cents DESC
    `);
    const rawAgents = (byAgentRes.rows as Array<{
      agent_id: string;
      name: string;
      type: string;
      minutes: string | number;
      cost_cents: string | number;
    }>).map((r) => ({
      agentId: r.agent_id,
      name: r.name,
      type: r.type,
      minutes: Math.round(Number(r.minutes) || 0),
      costCents: Number(r.cost_cents) || 0,
    }));
    const agentTotal = rawAgents.reduce((s, r) => s + r.costCents, 0);
    const agentRows: AgentRow[] = rawAgents.map((r) => ({
      ...r,
      share: agentTotal > 0 ? r.costCents / agentTotal : 0,
    }));

    return {
      rangeStart,
      rangeEnd,
      daysElapsed,
      daysInMonth,
      mtdCents,
      prevMonthCents,
      byFeature,
      byDay,
      forecastCents,
      featureRows,
      agentRows,
    };
  });
}

export default async function BillingPage() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const data = await loadBillingData(wsId);

  const isEmpty = data.mtdCents === 0 && data.featureRows.length === 0;

  // Pretty range label, e.g. "Apr 1 – Apr 25".
  const rangeLabel = formatRangeLabel(data.rangeStart, data.daysElapsed);
  const monthLabel = new Date(`${data.rangeStart}T00:00:00Z`).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const prevMonthLabel = new Date(`${data.rangeStart}T00:00:00Z`).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });

  // Vs-previous-month percentage. Hidden when there's no prior data so we
  // don't show "↑ ∞%" on the first-ever month.
  const vsPrev =
    data.prevMonthCents > 0
      ? Math.round(((data.mtdCents - data.prevMonthCents) / data.prevMonthCents) * 100)
      : null;

  // Forecast sparkline: cumulative spend per day, projected forward at the
  // trailing-14d daily-average rate. Anchored at 0 so the line always grows.
  const sparkline = buildForecastSparkline(data);

  return (
    <>
      <AppTopbar title="Billing" />
      <main className="flex-1 overflow-auto px-6 py-6">
        {/* ── Top: 3 cards ─────────────────────────────────────────────── */}
        <section className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
          {/* Current bill + stacked bar */}
          <div
            className="rounded-lg border border-line-soft p-5"
            style={{
              background:
                'linear-gradient(135deg, var(--accent-soft), transparent 70%)',
            }}
          >
            <div className="text-[11.5px] text-ink-3">
              Current bill · {rangeLabel}
            </div>
            <div className="mt-1 text-[32px] font-bold tracking-[-0.5px]">
              {formatUSD(data.mtdCents)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[11.5px]">
              {vsPrev !== null && (
                <span
                  className="rounded-md border border-line-soft bg-paper px-1.5 py-0.5 text-[10px]"
                  style={{ color: vsPrev >= 0 ? 'var(--ok)' : 'var(--ink-2)' }}
                >
                  {vsPrev >= 0 ? '↑' : '↓'} {Math.abs(vsPrev)}% vs {prevMonthLabel}
                </span>
              )}
              <span className="text-ink-3">
                {monthLabel} · {data.daysElapsed} of {data.daysInMonth} days
              </span>
            </div>

            <StackedBar buckets={data.byFeature} total={data.mtdCents} />

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {FEATURE_KEYS.map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: FEATURE_COLOR[k] }}
                  />
                  {FEATURE_LABEL[k]} {formatUSDShort(data.byFeature[k])}
                </span>
              ))}
            </div>
          </div>

          {/* Plan + usage progress bars */}
          <div className="rounded-lg border border-line-soft bg-paper p-5">
            <div className="text-[11.5px] text-ink-3">Plan</div>
            <div className="text-[18px] font-semibold">Build</div>
            <div className="text-xs text-ink-3">$49/mo + usage</div>
            <div className="my-3 h-px bg-line-softer" />

            {/* Progress bars use post-MVP plan limits (100 minutes, ? tokens).
                The spec says "minutes used / 100, tokens used"; we surface the
                computed numbers from usage_events so the bars are real, not
                static. Falls back to a clean empty bar at zero usage. */}
            <UsageBar
              label="Minutes used"
              used={planMinutesFrom(data.featureRows)}
              cap={100}
              color="var(--accent)"
              format={(n) => `${n.toLocaleString()} / 100`}
            />
            <div className="h-3" />
            <UsageBar
              label="AI tokens"
              used={planTokensFrom(data.featureRows)}
              cap={20_000_000}
              color="#60a5fa"
              format={(n) => `${formatTokensCompact(n)} / 20M`}
            />
          </div>

          {/* Forecast + sparkline */}
          <div className="rounded-lg border border-line-soft bg-paper p-5">
            <div className="text-[11.5px] text-ink-3">
              Forecast (close of {monthLabel})
            </div>
            <div className="text-[18px] font-semibold">
              ~{formatUSDShort(data.forecastCents)}
            </div>
            <Sparkline width={220} height={40} data={sparkline} />
            <div className="mt-1.5 text-[11px] text-ink-3">Based on last 14 days</div>
          </div>
        </section>

        {/* ── Two tables ──────────────────────────────────────────────── */}
        <section className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Cost by feature */}
          <div className="overflow-hidden rounded-lg border border-line-soft bg-paper">
            <div className="border-b border-line-softer px-4 py-3 text-[13px] font-semibold">
              Cost by feature
            </div>
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {isEmpty || data.featureRows.length === 0 ? (
                  <EmptyRow colSpan={3} />
                ) : (
                  data.featureRows.map((r, i) => (
                    <tr
                      key={r.eventType}
                      className={
                        i < data.featureRows.length - 1
                          ? 'border-b border-line-softer'
                          : ''
                      }
                    >
                      <td className="px-4 py-2.5 font-medium">{r.label}</td>
                      <td className="px-4 py-2.5 text-ink-3">
                        {formatUsage(r.usage, r.unit)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-ink-3">
                        {formatUnitPrice(r.unitPriceCents, r.unit)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold">
                        {formatUSD(r.totalCents)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Cost by agent */}
          <div className="overflow-hidden rounded-lg border border-line-soft bg-paper">
            <div className="border-b border-line-softer px-4 py-3 text-[13px] font-semibold">
              Cost by agent
            </div>
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {isEmpty || data.agentRows.length === 0 ? (
                  <EmptyRow colSpan={3} />
                ) : (
                  data.agentRows.map((r, i) => (
                    <tr
                      key={r.agentId}
                      className={
                        i < data.agentRows.length - 1
                          ? 'border-b border-line-softer'
                          : ''
                      }
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-[11px] text-ink-3">
                          {r.type} · {r.minutes.toLocaleString()} min
                        </div>
                      </td>
                      <td className="w-[130px] px-4 py-2.5">
                        <div className="h-1.5 rounded-sm bg-line-softer">
                          <div
                            className="h-full rounded-sm"
                            style={{
                              width: `${Math.round(r.share * 100)}%`,
                              background: 'var(--accent)',
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold">
                        {formatUSD(r.costCents)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Daily-spend chart ───────────────────────────────────────── */}
        <section className="rounded-lg border border-line-soft bg-paper p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="text-[13px] font-semibold">
              Daily spend · {monthLabel}
            </div>
            <div className="text-[11px] text-ink-3">
              Avg {formatUSD(averageDailyCents(data))} / day
            </div>
          </div>
          <DailyBars
            byDay={data.byDay}
            daysInMonth={data.daysInMonth}
            todayIndex={data.daysElapsed - 1}
          />
        </section>
      </main>
    </>
  );
}

// ─────────────────────────── helpers / sub-components ──────────────────────

function formatRangeLabel(rangeStart: string, daysElapsed: number): string {
  const start = new Date(`${rangeStart}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + Math.max(0, daysElapsed - 1));
  const fmt = (d: Date) =>
    d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function planMinutesFrom(rows: FeatureRow[]): number {
  return rows
    .filter((r) =>
      ['voice_synthesis', 'tts', 'speech_to_text', 'stt', 'telephony', 'twilio'].includes(
        r.eventType.toLowerCase(),
      ),
    )
    .reduce((s, r) => s + (r.unit === 'min' ? r.usage : 0), 0);
}

function planTokensFrom(rows: FeatureRow[]): number {
  return rows
    .filter((r) =>
      ['ai_inference', 'llm', 'inference'].includes(r.eventType.toLowerCase()),
    )
    .reduce((s, r) => s + r.usage, 0);
}

function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function averageDailyCents(data: BillingData): number {
  const total = data.byDay.reduce((s, r) => s + r.cents, 0);
  return data.byDay.length > 0 ? Math.round(total / data.byDay.length) : 0;
}

/**
 * Build a 14-point array for the forecast sparkline. We project cumulative
 * spend forward from today using the trailing-14d daily average so the line
 * always slopes upward and lands on `forecastCents`.
 */
function buildForecastSparkline(data: BillingData): number[] {
  const points = 14;
  if (data.daysInMonth <= 0) return Array.from({ length: points }, () => 0);

  const cumulative: number[] = [];
  let running = 0;
  for (const d of data.byDay) {
    running += d.cents;
    cumulative.push(running);
  }
  // Pad forward with linear projection up to month-end.
  const projectedDailyAvg =
    data.daysElapsed > 0 ? (data.forecastCents - data.mtdCents) / Math.max(1, data.daysInMonth - data.daysElapsed) : 0;
  for (let i = data.daysElapsed; i < data.daysInMonth; i++) {
    running += projectedDailyAvg;
    cumulative.push(Math.round(running));
  }

  // Down-sample to exactly `points` items.
  if (cumulative.length === 0) return Array.from({ length: points }, () => 0);
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const idx = Math.min(
      cumulative.length - 1,
      Math.floor((i / (points - 1)) * (cumulative.length - 1)),
    );
    out.push(cumulative[idx] ?? 0);
  }
  return out;
}

function StackedBar({
  buckets,
  total,
}: {
  buckets: Record<FeatureBucket, number>;
  total: number;
}) {
  const segments =
    total > 0
      ? FEATURE_KEYS.map((k) => ({
          k,
          pct: (buckets[k] / total) * 100,
        })).filter((s) => s.pct > 0)
      : [];

  return (
    <div
      className="mt-3.5 flex h-2 overflow-hidden rounded-sm bg-line-softer"
      role="img"
      aria-label="Spend breakdown by feature"
    >
      {segments.map((s) => (
        <div
          key={s.k}
          title={`${FEATURE_LABEL[s.k]} ${s.pct.toFixed(0)}%`}
          style={{ width: `${s.pct}%`, background: FEATURE_COLOR[s.k] }}
        />
      ))}
    </div>
  );
}

function UsageBar({
  label,
  used,
  cap,
  color,
  format,
}: {
  label: string;
  used: number;
  cap: number;
  color: string;
  format: (n: number) => string;
}) {
  const pct = cap > 0 ? Math.max(0, Math.min(100, (used / cap) * 100)) : 0;
  return (
    <>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-ink-3">{label}</span>
        <span className="font-medium">{format(used)}</span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-sm bg-line-softer">
        <div
          className="h-full rounded-sm"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </>
  );
}

function Sparkline({
  width,
  height,
  data,
}: {
  width: number;
  height: number;
  data: number[];
}) {
  if (data.length === 0) {
    return <svg width={width} height={height} className="mt-2" aria-hidden />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / Math.max(1, data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      className="mt-2"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DailyBars({
  byDay,
  daysInMonth,
  todayIndex,
}: {
  byDay: { date: string; cents: number }[];
  daysInMonth: number;
  todayIndex: number;
}) {
  // Always render `daysInMonth` columns so the chart has a consistent shape;
  // future days are dimmed.
  const max = Math.max(1, ...byDay.map((d) => d.cents));
  const cells = Array.from({ length: daysInMonth }, (_, i) => byDay[i]?.cents ?? 0);

  // Tick labels Apr 1 / 8 / 15 / 22 / 30-style, anchored to the actual month.
  const monthDate = byDay[0]?.date ? new Date(`${byDay[0].date}T00:00:00Z`) : new Date();
  const monthShort = monthDate.toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });

  return (
    <>
      <div
        className="flex h-[100px] items-end gap-[3px]"
        role="img"
        aria-label="Daily spend"
      >
        {cells.map((cents, i) => {
          // Min height of 4px so empty days are still visible — keeps the
          // chart from looking broken on a brand-new workspace.
          const h = cents > 0 ? Math.max(4, (cents / max) * 100) : 4;
          const isToday = i === todayIndex;
          const isFuture = i > todayIndex;
          return (
            <div
              key={i}
              className="flex-1 rounded-[2px]"
              style={{
                height: `${h}px`,
                background: isToday ? 'var(--ink)' : 'var(--accent)',
                opacity: isFuture ? 0.25 : 1,
              }}
              title={`Day ${i + 1}: ${formatUSD(cents)}`}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-ink-4">
        <span>{monthShort} 1</span>
        <span>{monthShort} 8</span>
        <span>{monthShort} 15</span>
        <span>{monthShort} 22</span>
        <span>
          {monthShort} {daysInMonth}
        </span>
      </div>
    </>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td
        className="px-4 py-6 text-center text-[12.5px] text-ink-3"
        colSpan={colSpan + 1}
      >
        $0.00 — start a conversation to see costs here.
      </td>
    </tr>
  );
}
