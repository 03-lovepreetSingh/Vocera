/**
 * REST: cost-by-agent breakdown for a given month.
 *
 *   GET /api/v1/billing/by-agent?month=YYYY-MM   (defaults to current month)
 *
 * Joins `usage_events` to `agents` and returns one row per agent with
 *   - agent name + purpose ("type")
 *   - total minutes (sum of `quantity` for voice-related event types)
 *   - total cost in cents
 *   - share of the workspace total (0–1)
 *
 * Stub-safe: if `usage_events` doesn't exist yet, returns an empty array.
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { auth } from '@/server/auth/config';

export type BillingAgentRow = {
  agentId: string; // external id (safe for the URL bar)
  name: string;
  type: string; // agent.purpose, e.g. 'support' | 'lead-qual' | ...
  minutes: number;
  costCents: number;
  share: number; // 0..1
};

export type BillingByAgentResponse = {
  month: string;
  rows: BillingAgentRow[];
  totalCents: number;
};

const QuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/u, 'month must be YYYY-MM')
    .optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({ month: url.searchParams.get('month') ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const month = parsed.data.month ?? new Date().toISOString().slice(0, 7);
  const start = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: 'invalid month' }, { status: 400 });
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const result = await withWorkspace(wsId, async (tx): Promise<BillingByAgentResponse> => {
    const exists = await tx.execute(sql`SELECT to_regclass('public.usage_events') AS rel`);
    if (((exists.rows[0] as { rel: string | null } | undefined)?.rel ?? null) === null) {
      return { month, rows: [], totalCents: 0 };
    }

    // Join `usage_events` to `agents`. We sum `quantity` only for the voice-ish
    // event types that are denominated in minutes — summing token counts in the
    // same column would be nonsense.
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const res = await tx.execute(sql`
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
      WHERE u.occurred_at >= ${startIso}::timestamptz
        AND u.occurred_at <  ${endIso}::timestamptz
      GROUP BY a.external_id, a.name, a.purpose
      ORDER BY cost_cents DESC
    `);

    type Row = {
      agent_id: string;
      name: string;
      type: string;
      minutes: string | number;
      cost_cents: string | number;
    };

    const rawRows = (res.rows as Row[]).map((r) => ({
      agentId: r.agent_id,
      name: r.name,
      type: r.type,
      minutes: Math.round(Number(r.minutes) || 0),
      costCents: Number(r.cost_cents) || 0,
    }));

    const totalCents = rawRows.reduce((s, r) => s + r.costCents, 0);
    const rows: BillingAgentRow[] = rawRows.map((r) => ({
      ...r,
      share: totalCents > 0 ? r.costCents / totalCents : 0,
    }));

    return { month, rows, totalCents };
  });

  return NextResponse.json(result);
}
