/**
 * Mint a one-time session token for the WebSocket voice connection.
 * The token is a short opaque id; the WS handler dereferences it via Postgres.
 */
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { withWorkspace } from '@/db/client';
import { agents } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { issueSession } from '@/server/ws/sessions';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const found = await withWorkspace(wsId, (tx) =>
    tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.workspaceId, wsId), eq(agents.externalId, params.id)))
      .limit(1)
      .then((rows) => rows[0]),
  );
  if (!found) return NextResponse.json({ error: 'agent not found' }, { status: 404 });

  const token = await issueSession({ workspaceId: wsId, agentId: found.id });
  return NextResponse.json({ token });
}
