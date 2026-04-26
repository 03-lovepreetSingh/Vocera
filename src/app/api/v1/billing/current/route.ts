/**
 * REST: current-month billing summary for the workspace.
 *
 * Reads `usage_events` for the current calendar month (UTC) and returns:
 *   - mtdCents:        sum of price_cents (month-to-date)
 *   - byFeature:       break-down of mtdCents by event_type (Voice/AI/Telephony/KB/Other)
 *   - byDay:           per-day spend over the current month (zero-filled to today)
 *   - forecastCents:   rolling 14-day moving-average × days remaining + MTD
 *   - rangeStart/End:  ISO dates bounding the current month
 *   - daysElapsed/InMonth
 *
 * The `usage_events` table is part of a future migration. If the table doesn't
 * exist yet we return a zero-valued stub so the page renders cleanly with the
 * empty-state row instead of 500-ing.
 *
 * All queries run inside withWorkspace(...) so RLS guarantees tenant isolation.
 */
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { withWorkspace } from '@/db/client';
import { auth } from '@/server/auth/config';

export type BillingFeatureBucket =
  | 'voice'
  | 'ai'
  | 'telephony'
  | 'kb'
  | 'other';

export type BillingCurrentResponse = {
  rangeStart: string; // YYYY-MM-DD
  rangeEnd: string; // YYYY-MM-DD (inclusive)
  daysElapsed: number;
  daysInMonth: number;
  mtdCents: number;
  byFeature: Record<BillingFeatureBucket, number>;
  byDay: { date: string; cents: number }[];
  forecastCents: number;
};

const FEATURE_KEYS: BillingFeatureBucket[] = [
  'voice',
  'ai',
  'telephony',
  'kb',
  'other',
];

function emptyBuckets(): Record<BillingFeatureBucket, number> {
  return FEATURE_KEYS.reduce(
    (acc, k) => {
      acc[k] = 0;
      return acc;
    },
    {} as Record<BillingFeatureBucket, number>,
  );
}

/**
 * Map a raw `event_type` from `usage_events` into one of the 5 display buckets.
 * Unknown event types fall through to 'other' so totals always reconcile.
 */
function bucketFor(eventType: string): BillingFeatureBucket {
  const t = eventType.toLowerCase();
  if (t.startsWith('voice') || t === 'tts' || t === 'stt') return 'voice';
  if (t.startsWith('ai') || t === 'llm' || t === 'inference') return 'ai';
  if (t.startsWith('telephony') || t === 'twilio') return 'telephony';
  if (t.startsWith('kb') || t === 'knowledge' || t === 'storage') return 'kb';
  return 'other';
}

export async function GET() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const data = await withWorkspace(wsId, async (tx): Promise<BillingCurrentResponse> => {
    // Compute month bounds + day counters once. We do this in SQL so the values
    // line up with the queries below (same UTC clock, no client-skew issues).
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

    // Existence-check: `to_regclass` returns NULL when the relation doesn't
    // exist, so we can short-circuit to an all-zero response without 500-ing.
    const existsRes = await tx.execute(sql`
      SELECT to_regclass('public.usage_events') AS rel
    `);
    const tableExists =
      ((existsRes.rows[0] as { rel: string | null } | undefined)?.rel ?? null) !== null;

    if (!tableExists) {
      // Return a zero-filled day series so the bar chart still renders.
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
        byFeature: emptyBuckets(),
        byDay,
        forecastCents: 0,
      };
    }

    // MTD total + per-bucket breakdown.
    // We aggregate the raw `event_type` and remap to display buckets in JS so
    // the SQL stays schema-tolerant if new event types are introduced.
    const byTypeRes = await tx.execute(sql`
      SELECT event_type::text AS event_type,
             COALESCE(SUM(price_cents), 0)::bigint AS cents
      FROM usage_events
      WHERE occurred_at >= date_trunc('month', now() at time zone 'utc')
        AND occurred_at <  date_trunc('month', now() at time zone 'utc') + interval '1 month'
      GROUP BY event_type
    `);

    const byFeature = emptyBuckets();
    let mtdCents = 0;
    for (const row of byTypeRes.rows as Array<{ event_type: string; cents: string | number }>) {
      const cents = Number(row.cents) || 0;
      mtdCents += cents;
      byFeature[bucketFor(row.event_type)] += cents;
    }

    // Per-day spend, zero-filled across days elapsed in the month.
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

    // Forecast: rolling 14-day moving average × days remaining + MTD.
    // Using the trailing window (not just calendar-month days) means a brand-new
    // workspace doesn't get a wildly low number on day 2 of the month.
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

    return {
      rangeStart,
      rangeEnd,
      daysElapsed,
      daysInMonth,
      mtdCents,
      byFeature,
      byDay,
      forecastCents,
    };
  });

  return NextResponse.json(data);
}
