/**
 * REST: read + patch the current workspace.
 *
 * Auth is the session cookie — programmatic API-key access for tenant-level
 * mutations is intentionally out of scope (an attacker who steals a key
 * shouldn't be able to rename or move regions).
 */
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { workspaces } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { slugify } from '@/lib/utils';

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: z.string().trim().min(2).max(48).optional(),
    dataRegion: z.enum(['us', 'eu', 'in']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export async function GET() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const row = (
    await db
      .select({
        id: workspaces.externalId,
        name: workspaces.name,
        slug: workspaces.slug,
        dataRegion: workspaces.dataRegion,
        plan: workspaces.plan,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, wsId))
      .limit(1)
  )[0];

  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ workspace: row });
}

export async function PATCH(req: Request) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const patch = parsed.data;
  const update: Partial<typeof workspaces.$inferInsert> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.slug !== undefined) update.slug = slugify(patch.slug);
  if (patch.dataRegion !== undefined) update.dataRegion = patch.dataRegion;

  const [updated] = await db
    .update(workspaces)
    .set(update)
    .where(eq(workspaces.id, wsId))
    .returning({
      id: workspaces.externalId,
      name: workspaces.name,
      slug: workspaces.slug,
      dataRegion: workspaces.dataRegion,
      plan: workspaces.plan,
    });

  return NextResponse.json({ workspace: updated });
}
