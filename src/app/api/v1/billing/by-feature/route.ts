/**
 * REST: cost-by-feature breakdown for a given month.
 *
 *   GET /api/v1/billing/by-feature?month=YYYY-MM   (defaults to current month)
 *
 * Returns one row per `event_type` with usage count, unit, and total cents:
 *   [{ eventType, label, usage, unit, unitPriceCents, totalCents }, ...]
 *
 * The `label` and `unit` are derived from the event_type so the front-end can
 * render the table without an extra dictionary. Stub-safe: if `usage_events`
 * doesn't exist yet, returns an empty array.
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { auth } from '@/server/auth/config';

export type BillingFeatureRow = {
  eventType: string;
  label: string;
  usage: number; // raw quantity (minutes, tokens, requests, etc.)
  unit: string; // 'min' | '1k tok' | 'req' | 'storage' | ''
  unitPriceCents: number; // weighted-avg unit price in cents (0 if usage==0)
  totalCents: number;
};

export type BillingByFeatureResponse = {
  month: string; // YYYY-MM
  rows: BillingFeatureRow[];
};

const QuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/u, 'month must be YYYY-MM')
    .optional(),
});

/** Display label + unit for known event types. Falls back to titleized type. */
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

export async function GET(req: NextRequest) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({ month: url.searchParams.get('month') ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Resolve month to a UTC range. Default = current calendar month.
  const month =
    parsed.data.month ?? new Date().toISOString().slice(0, 7); // YYYY-MM
  const monthStart = `${month}-01T00:00:00Z`;
  const start = new Date(monthStart);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: 'invalid month' }, { status: 400 });
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const rows = await withWorkspace(wsId, async (tx): Promise<BillingFeatureRow[]> => {
    const exists = await tx.execute(sql`SELECT to_regclass('public.usage_events') AS rel`);
    if (((exists.rows[0] as { rel: string | null } | undefined)?.rel ?? null) === null) {
      return [];
    }

    // SUM(price_cents) GROUP BY event_type, plus weighted unit price for display.
    // We coalesce `quantity` to 0 because not every event row carries one
    // (e.g. flat-rate webhook charges).
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const res = await tx.execute(sql`
      SELECT
        event_type::text                              AS event_type,
        COALESCE(SUM(quantity), 0)::numeric           AS usage,
        COALESCE(SUM(price_cents), 0)::bigint         AS total_cents
      FROM usage_events
      WHERE occurred_at >= ${startIso}::timestamptz
        AND occurred_at <  ${endIso}::timestamptz
      GROUP BY event_type
      ORDER BY total_cents DESC
    `);

    return (res.rows as Array<{ event_type: string; usage: string | number; total_cents: string | number }>).map(
      (r) => {
        const usage = Number(r.usage) || 0;
        const totalCents = Number(r.total_cents) || 0;
        // Avoid divide-by-zero — if usage is 0 (flat-rate / storage), unit
        // price is meaningless, so report 0 and let the UI decide what to show.
        const unitPriceCents = usage > 0 ? totalCents / usage : 0;
        const { label, unit } = describeEventType(r.event_type);
        return {
          eventType: r.event_type,
          label,
          usage,
          unit,
          unitPriceCents,
          totalCents,
        };
      },
    );
  });

  const body: BillingByFeatureResponse = { month, rows };
  return NextResponse.json(body);
}
