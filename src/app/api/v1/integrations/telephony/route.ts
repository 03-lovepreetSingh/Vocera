/**
 * REST: list / upsert / delete per-workspace telephony carrier credentials.
 *
 * Wave 4 #15a — backs the Integrations UI when users paste Twilio creds.
 * Auth: session cookie. The plaintext auth token is encrypted at rest via
 * AES-256-GCM (`@/server/crypto/secrets`) and is NEVER returned by GET.
 * SID is returned masked (first 4 + last 2) so the user can recognize it.
 */
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { telephonyCredentials } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { encrypt } from '@/server/crypto/secrets';

const CreateSchema = z.object({
  provider: z.literal('twilio'), // future: enum(['twilio','exotel','plivo','vonage'])
  accountSid: z.string().regex(/^AC[a-f0-9]{32}$/i, 'must be a Twilio Account SID'),
  authToken: z.string().min(20).max(80),
  phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/, 'must be E.164'),
});

/** Mask: keep `AC` prefix recognizable, hide the middle, show last 2. */
function maskSid(sid: string): string {
  if (sid.length < 6) return `${sid}...`;
  return `${sid.slice(0, 4)}...${sid.slice(-2)}`;
}

type Row = {
  id: number;
  provider: string;
  accountSid: string;
  phoneNumber: string;
  createdAt: Date;
  updatedAt: Date;
};

function shape(r: Row) {
  return {
    id: r.id,
    provider: r.provider,
    accountSidMasked: maskSid(r.accountSid),
    phoneNumber: r.phoneNumber,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function GET() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rows = await withWorkspace(wsId, (tx) =>
    tx
      .select({
        id: telephonyCredentials.id,
        provider: telephonyCredentials.provider,
        accountSid: telephonyCredentials.accountSid,
        phoneNumber: telephonyCredentials.phoneNumber,
        createdAt: telephonyCredentials.createdAt,
        updatedAt: telephonyCredentials.updatedAt,
      })
      .from(telephonyCredentials)
      .where(eq(telephonyCredentials.workspaceId, wsId))
      .orderBy(desc(telephonyCredentials.createdAt)),
  );

  return NextResponse.json({ providers: rows.map(shape) });
}

export async function POST(req: Request) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    // Log only failing field names — never values (auth token must not leak).
    console.warn('[telephony] validation failed', Object.keys(parsed.error.flatten().fieldErrors));
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { provider, accountSid, authToken, phoneNumber } = parsed.data;
  const authTokenEncrypted = encrypt(authToken);

  const row = await withWorkspace(wsId, async (tx) => {
    const [r] = await tx
      .insert(telephonyCredentials)
      .values({ workspaceId: wsId, provider, accountSid, authTokenEncrypted, phoneNumber })
      .onConflictDoUpdate({
        target: [
          telephonyCredentials.workspaceId,
          telephonyCredentials.provider,
          telephonyCredentials.phoneNumber,
        ],
        set: { accountSid, authTokenEncrypted, updatedAt: new Date() },
      })
      .returning({
        id: telephonyCredentials.id,
        provider: telephonyCredentials.provider,
        accountSid: telephonyCredentials.accountSid,
        phoneNumber: telephonyCredentials.phoneNumber,
        createdAt: telephonyCredentials.createdAt,
        updatedAt: telephonyCredentials.updatedAt,
      });
    return r;
  });

  return NextResponse.json(shape(row), { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const idParam = new URL(req.url).searchParams.get('id');
  const id = idParam ? Number(idParam) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const deleted = await withWorkspace(wsId, async (tx) => {
    // AND on workspace_id is belt-and-suspenders alongside RLS.
    const rows = await tx
      .delete(telephonyCredentials)
      .where(and(eq(telephonyCredentials.id, id), eq(telephonyCredentials.workspaceId, wsId)))
      .returning({ id: telephonyCredentials.id });
    return rows.length;
  });

  if (deleted === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
