/**
 * REST: top intents over the last 30 days for the Analysis page.
 *
 * Returns the top 5 intents by conversation count (intent IS NOT NULL),
 * tenant-scoped via withWorkspace + RLS.
 */
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { withWorkspace } from '@/db/client';
import { auth } from '@/server/auth/config';

export type TopIntent = { intent: string; count: number };
export type IntentsResponse = { intents: TopIntent[] };

const DAYS = 30;
const LIMIT = 5;

export async function GET() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const intents = await withWorkspace(wsId, async (tx): Promise<TopIntent[]> => {
    const res = await tx.execute(sql`
      SELECT intent, COUNT(*)::int AS count
      FROM conversations
      WHERE intent IS NOT NULL
        AND intent <> ''
        AND started_at > now() - (${DAYS}::int || ' days')::interval
      GROUP BY intent
      ORDER BY count DESC
      LIMIT ${LIMIT}
    `);
    return (res.rows as Array<{ intent: string; count: number }>).map((r) => ({
      intent: r.intent,
      count: Number(r.count) || 0,
    }));
  });

  return NextResponse.json({ intents } satisfies IntentsResponse);
}
