/**
 * Public Twilio Programmable Voice status callback.
 *
 * Twilio POSTs here on every call lifecycle transition (queued, ringing,
 * in-progress, completed, busy, failed, no-answer, canceled). We match the
 * event back to the conversation row created by the WS adapter via CallSid,
 * persist terminal status / endedAt, and ack with 200.
 *
 * Auth: X-Twilio-Signature, same scheme as the voice webhook. Early-lifecycle
 * events (queued, ringing) commonly fire before the WS adapter inserts the
 * row; we no-op + 200 so Twilio doesn't retry-storm us. We also never 5xx —
 * any handler error is logged and swallowed.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { withWorkspace } from '@/db/client';
import { conversations } from '@/db/schema';
import { loadDeploymentByToken } from '@/server/twilio/loader';
import { reconstructFullUrl, verifyTwilioSignature } from '@/server/twilio/signature';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const plain = (body: string, status: number) =>
  new NextResponse(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const ok = () => plain('', 200);

function mapStatus(s: string): 'completed' | 'failed' | null {
  if (s === 'completed') return 'completed';
  if (s === 'failed' || s === 'busy' || s === 'no-answer' || s === 'canceled') return 'failed';
  return null; // queued|ringing|in-progress|unknown — leave row alone
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  try {
    let p: Record<string, string> = {};
    try {
      const fd = await req.formData();
      for (const [k, v] of fd.entries()) p[k] = typeof v === 'string' ? v : '';
    } catch { return plain('invalid body', 400); }

    const fullUrl = reconstructFullUrl(req);
    const loaded = await loadDeploymentByToken(params.token);
    if (!loaded) return plain('not found', 404);

    if (!loaded.telephony || !loaded.telephony.authToken) return plain('telephony not configured', 403);
    const signature = req.headers.get('x-twilio-signature');
    if (!signature) return plain('signature missing', 403);
    if (!verifyTwilioSignature({ authToken: loaded.telephony.authToken, fullUrl, params: p, signature })) {
      return plain('signature mismatch', 403);
    }

    const callSid = p.CallSid;
    const callStatus = p.CallStatus;
    if (!callSid || !callStatus) return ok();

    await withWorkspace(loaded.workspaceId, async (tx) => {
      const [row] = await tx
        .select({ id: conversations.id }).from(conversations)
        .where(and(
          eq(conversations.externalCallSid, callSid),
          eq(conversations.workspaceId, loaded.workspaceId),
        )).limit(1);
      if (!row) {
        console.debug('[twilio.status] no row yet callSid=%s status=%s', callSid, callStatus);
        return;
      }
      const mapped = mapStatus(callStatus);
      const patch: { status?: string; endedAt?: Date } = {};
      if (mapped) patch.status = mapped;
      if (callStatus === 'completed') patch.endedAt = new Date();
      // CallDuration ignored — durationMs is derived from started/ended.
      // TODO(recording): persist p.RecordingUrl once conversations gains a metadata JSONB column.
      if (p.RecordingUrl) {
        console.log('[twilio.status] recording callSid=%s url=%s', callSid, p.RecordingUrl);
      }
      if (Object.keys(patch).length > 0) {
        await tx.update(conversations).set(patch).where(eq(conversations.id, row.id));
      }
    });
    return ok();
  } catch (err) {
    console.error('[twilio.status] handler error', err);
    return ok(); // never 5xx — Twilio retries would thrash us.
  }
}

export async function GET() {
  return new NextResponse('method not allowed', {
    status: 405,
    headers: { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' },
  });
}
