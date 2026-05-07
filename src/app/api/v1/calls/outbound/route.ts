/**
 * REST: place an outbound Twilio call. Twilio dials the callee, then POSTs to
 * /api/twilio/voice/[token]?direction=outbound, which returns TwiML opening our
 * WS adapter — same pipeline as inbound IVR. Auth: workspace-scoped session.
 */
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { agents, deployments, telephonyCredentials, voiceDeployments } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { decrypt } from '@/server/crypto/secrets';

const BodySchema = z.object({
  to: z.string().regex(/^\+[1-9]\d{6,14}$/, 'must be E.164'),
  agent_id: z.string().min(1),
  deployment_id: z.string().optional(),
  opener: z.string().max(500).optional(),
});

type TwilioRestError = { status?: number; code?: number | string; message?: string };

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
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.opener) {
    // Per-call openers require request-scoped state; deferred for v1.
    console.warn('[calls/outbound] per-call opener provided but ignored (deferred)');
  }

  const base = process.env.NEXT_PUBLIC_VOICE_WEBHOOK_HOST;
  if (!base) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_VOICE_WEBHOOK_HOST not set' }, { status: 500 });
  }

  const resolved = await withWorkspace(wsId, async (tx) => {
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.workspaceId, wsId), eq(agents.externalId, data.agent_id)))
      .limit(1);
    if (!agent) return { error: 'agent not found', status: 404 } as const;

    const baseDepCond = and(
      eq(deployments.workspaceId, wsId),
      eq(deployments.agentId, agent.id),
      eq(deployments.surface, 'voice'),
    );
    const where = data.deployment_id
      ? and(baseDepCond, eq(deployments.externalId, data.deployment_id))
      : baseDepCond;

    const [dep] = await tx
      .select({ webhookToken: voiceDeployments.webhookToken })
      .from(deployments)
      .innerJoin(voiceDeployments, eq(voiceDeployments.deploymentId, deployments.id))
      .where(where)
      .limit(1);
    if (!dep?.webhookToken) {
      return { error: 'no voice deployment for agent', status: 400 } as const;
    }

    const [creds] = await tx
      .select({
        accountSid: telephonyCredentials.accountSid,
        authTokenEncrypted: telephonyCredentials.authTokenEncrypted,
        phoneNumber: telephonyCredentials.phoneNumber,
      })
      .from(telephonyCredentials)
      .where(
        and(
          eq(telephonyCredentials.workspaceId, wsId),
          eq(telephonyCredentials.provider, 'twilio'),
        ),
      )
      .limit(1);
    if (!creds) {
      return {
        error: 'twilio not configured for workspace — connect via /integrations',
        status: 400,
      } as const;
    }
    return { webhookToken: dep.webhookToken, creds };
  });

  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const authToken = decrypt(resolved.creds.authTokenEncrypted);
  const voiceUrl = `${base}/api/twilio/voice/${resolved.webhookToken}?direction=outbound`;
  const statusUrl = `${base}/api/twilio/status/${resolved.webhookToken}`;
  const fromNumber = process.env.TWILIO_FROM_NUMBER ?? resolved.creds.phoneNumber;

  try {
    const client = twilio(resolved.creds.accountSid, authToken);
    const call = await client.calls.create({
      to: data.to,
      from: fromNumber,
      url: voiceUrl,
      statusCallback: statusUrl,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });
    return NextResponse.json(
      { call_sid: call.sid, to: call.to, from: call.from, status: call.status },
      { status: 201 },
    );
  } catch (err) {
    const e = err as TwilioRestError;
    const httpStatus = typeof e.status === 'number' ? e.status : 500;
    console.error('[calls/outbound] twilio error', { status: httpStatus, code: e.code });
    if (httpStatus >= 400 && httpStatus < 500) {
      return NextResponse.json(
        { error: `twilio: ${e.message ?? 'request rejected'}`, code: e.code },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'twilio upstream' }, { status: 502 });
  }
}
