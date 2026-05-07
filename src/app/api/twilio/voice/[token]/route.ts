/**
 * Public Twilio Programmable Voice webhook. Twilio POSTs here for inbound
 * calls (or when our outbound REST kicks one off with ?direction=outbound)
 * and we reply with TwiML opening a Media Stream WS to ws-server.
 *
 * Auth: X-Twilio-Signature only — no session, no API key. Naturally idempotent
 * (no DB writes here — the WS adapter creates the conversation row), so
 * Twilio's 5xx retry behaviour is safe.
 */
import { NextResponse } from 'next/server';
import { loadDeploymentByToken } from '@/server/twilio/loader';
import { reconstructFullUrl, verifyTwilioSignature } from '@/server/twilio/signature';
import { buildConnectStreamTwiML } from '@/server/twilio/twiml';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function plain(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function stripScheme(host: string): string {
  return host.replace(/^(wss?:\/\/|https?:\/\/)/i, '');
}

export async function POST(
  req: Request,
  { params }: { params: { token: string } },
) {
  const token = params.token;

  // 1. Parse Twilio's form-encoded body into a flat scalar map.
  let formParams: Record<string, string> = {};
  try {
    const fd = await req.formData();
    for (const [k, v] of fd.entries()) {
      formParams[k] = typeof v === 'string' ? v : '';
    }
  } catch {
    return plain('invalid body', 400);
  }

  // 2. Reconstruct the literal URL Twilio called (must include ?direction=… if any).
  const fullUrl = reconstructFullUrl(req);

  // 3. Load deployment by webhook token. Plaintext 404 — Twilio's UI handles it better.
  const loaded = await loadDeploymentByToken(token);
  if (!loaded) return plain('not found', 404);

  // 4. Verify signature.
  if (!loaded.telephony || !loaded.telephony.authToken) {
    return plain('telephony not configured', 403);
  }
  const signature = req.headers.get('x-twilio-signature');
  if (!signature) return plain('signature missing', 403);
  const ok = verifyTwilioSignature({
    authToken: loaded.telephony.authToken,
    fullUrl,
    params: formParams,
    signature,
  });
  if (!ok) return plain('signature mismatch', 403);

  // 5. Build the Media Stream WS URL. WS_PUBLIC_HOST must be a bare host[:port].
  const rawHost = process.env.WS_PUBLIC_HOST;
  if (!rawHost) {
    console.warn('[twilio.voice] WS_PUBLIC_HOST not configured');
    return plain('WS_PUBLIC_HOST not configured', 500);
  }
  if (/^(wss?:\/\/|https?:\/\/)/i.test(rawHost)) {
    console.warn('[twilio.voice] WS_PUBLIC_HOST contains scheme; stripping defensively');
  }
  const wsHost = stripScheme(rawHost);
  const wsUrl = `wss://${wsHost}/twilio/${token}`;

  // 6. Direction: ?direction=outbound when our outbound REST kicked off the call.
  const direction =
    new URL(req.url).searchParams.get('direction') === 'outbound' ? 'outbound' : 'inbound';

  // 7. TwiML — <Connect><Stream> for full-duplex audio.
  const xml = buildConnectStreamTwiML({
    wsUrl,
    customParameters: {
      direction,
      callSid: formParams.CallSid ?? '',
    },
  });

  console.log(
    '[twilio.voice] accepted webhook deployment=%s direction=%s',
    loaded.deployment.externalId,
    direction,
  );
  return new NextResponse(xml, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}

// Twilio sometimes probes with GET when a number is misconfigured — answer
// cleanly with 405 + Allow so the operator sees what's wrong.
export async function GET() {
  return new NextResponse('method not allowed', {
    status: 405,
    headers: { 'content-type': 'text/plain; charset=utf-8', allow: 'POST' },
  });
}
