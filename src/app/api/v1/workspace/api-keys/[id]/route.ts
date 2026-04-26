/**
 * REST: revoke a workspace API key.
 *
 * Soft delete — we set `revoked_at` rather than dropping the row so audit logs
 * referencing the key remain joinable. Auth subsystems should treat any key
 * with a non-null `revoked_at` as invalid.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { withWorkspace } from '@/db/client';
import { apiKeys } from '@/db/schema';
import { auth } from '@/server/auth/config';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const updated = await withWorkspace(wsId, async (tx) => {
    const [row] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.workspaceId, wsId),
          eq(apiKeys.externalId, params.id),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ externalId: apiKeys.externalId });
    return row;
  });

  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ id: updated.externalId, revoked: true });
}
