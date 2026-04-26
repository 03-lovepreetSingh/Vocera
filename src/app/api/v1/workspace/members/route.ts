/**
 * REST: list memberships and create invites for the current workspace.
 *
 * GET   — every member can list (so the Members page works for non-admins).
 * POST  — admin-only invite by email. Real email + token issuance is owned
 *         by the auth provisioning agent; this endpoint validates the input
 *         and returns the would-be invite so the UI can echo it back.
 */
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { memberships, users } from '@/db/schema';
import { auth } from '@/server/auth/config';

const InviteSchema = z.object({
  email: z.string().trim().email().max(255),
  role: z.enum(['admin', 'member', 'viewer']),
});

export async function GET() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rows = await withWorkspace(wsId, (tx) =>
    tx
      .select({
        userId: users.externalId,
        email: users.email,
        name: users.name,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, wsId)),
  );

  return NextResponse.json({ members: rows });
}

export async function POST(req: Request) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Stub response — real invite + email delivery lives in the auth agent.
  // Returning 202 communicates "accepted, not yet processed".
  return NextResponse.json(
    {
      invite: {
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role,
        status: 'pending',
      },
    },
    { status: 202 },
  );
}
