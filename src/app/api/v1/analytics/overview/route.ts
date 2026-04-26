/**
 * REST: workspace analytics overview for the Analysis page.
 *
 * Returns a tenant-scoped rollup over the last 30 days:
 *   - conversations.total + per-day series (split by channel: voice vs support)
 *   - leadsCaptured (conversations with a non-null caller_name OR caller_id)
 *   - resolvedPct (status = 'completed' / total, 0 when total = 0)
 *   - avgHandleMs (avg duration_ms over conversations that have one)
 *
 * All queries run inside withWorkspace(...) so RLS guarantees tenant isolation.
 */
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { withWorkspace } from '@/db/client';
import { auth } from '@/server/auth/config';

export type AnalyticsOverview = {
  conversations: {
    total: number;
    byDay: { date: string; voice: number; support: number }[];
  };
  leadsCaptured: number;
  resolvedPct: number;
  avgHandleMs: number;
};

const DAYS = 30;

export async function GET() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const data = await withWorkspace(wsId, async (tx): Promise<AnalyticsOverview> => {
    // Per-day, per-channel counts. We generate the 30-day series in SQL so days
    // with zero conversations still appear (clean chart, no gaps).
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

    const byDay = (byDayRes.rows as Array<{ date: string; voice: number; support: number }>).map(
      (r) => ({
        date: r.date,
        voice: Number(r.voice) || 0,
        support: Number(r.support) || 0,
      }),
    );

    // Aggregate stats over the same 30-day window.
    const aggRes = await tx.execute(sql`
      SELECT
        COUNT(*)::int                                                    AS total,
        COALESCE(SUM(CASE
          WHEN caller_name IS NOT NULL OR caller_id IS NOT NULL THEN 1 ELSE 0
        END), 0)::int                                                    AS leads,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)::int AS resolved,
        COALESCE(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), 0)::int AS avg_handle_ms
      FROM conversations
      WHERE started_at > now() - (${DAYS}::int || ' days')::interval
    `);

    const agg = (aggRes.rows[0] ?? {
      total: 0,
      leads: 0,
      resolved: 0,
      avg_handle_ms: 0,
    }) as { total: number; leads: number; resolved: number; avg_handle_ms: number };

    const total = Number(agg.total) || 0;
    const resolved = Number(agg.resolved) || 0;
    const leadsCaptured = Number(agg.leads) || 0;
    const avgHandleMs = Number(agg.avg_handle_ms) || 0;

    return {
      conversations: { total, byDay },
      leadsCaptured,
      resolvedPct: total === 0 ? 0 : Math.round((resolved / total) * 100),
      avgHandleMs,
    };
  });

  return NextResponse.json(data);
}
