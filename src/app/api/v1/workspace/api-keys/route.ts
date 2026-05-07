/**
 * REST: list and mint workspace API keys.
 *
 * Auth: session cookie (console UI). The plaintext key is returned ONCE on POST
 * — we never store it, only the argon2id hash + a public prefix for display.
 */
import { hash as argon2Hash } from '@node-rs/argon2';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { apiKeys } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { newId } from '@/server/ids';

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  scope: z.enum(['live', 'test']).default('live'),
});

/** Stable, non-secret display string for an existing key — no plaintext involved. */
function maskedFromPrefix(prefix: string): string {
  return `${prefix}••••••••••••`;
}

export async function GET() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rows = await withWorkspace(wsId, (tx) =>
    tx
      .select({
        externalId: apiKeys.externalId,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scope: apiKeys.scope,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.workspaceId, wsId), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt)),
  );

  return NextResponse.json({
    keys: rows.map((r) => ({
      id: r.externalId,
      name: r.name,
      prefix: r.prefix,
      masked: maskedFromPrefix(r.prefix),
      scope: r.scope,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  const userIdNum = session?.user?.userIdNum;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, scope } = parsed.data;

  // Mint plaintext key. Format mirrors `provisionUser`:
  //   voc_<scope>_<6 random chars>_<10 random chars>
  const keyExt = newId('key');
  const secret = newId('key').slice(4); // 10-char random secret
  const prefix = `voc_${scope}_${keyExt.slice(4, 10)}`;
  const plaintext = `${prefix}_${secret}`;
  const hash = await argon2Hash(plaintext);

  // RLS: insert under the tenant fence so workspace_id is enforced.
  // session.user.id is the user's external id (string) — derive numeric if needed.
  const created = await withWorkspace(wsId, async (tx) => {
    const [row] = await tx
      .insert(apiKeys)
      .values({
        externalId: keyExt,
        workspaceId: wsId,
        name,
        prefix,
        hash,
        scope,
        // createdBy is a numeric users.id — only set if the session carries it.
        createdBy: typeof userIdNum === 'number' ? userIdNum : null,
      })
      .returning({
        externalId: apiKeys.externalId,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scope: apiKeys.scope,
        createdAt: apiKeys.createdAt,
      });
    return row;
  });

  return NextResponse.json(
    {
      // The ONLY response that ever contains the plaintext. Caller must show-once.
      key: plaintext,
      id: created.externalId,
      name: created.name,
      prefix: created.prefix,
      masked: maskedFromPrefix(created.prefix),
      scope: created.scope,
      lastUsedAt: null,
      createdAt: created.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
