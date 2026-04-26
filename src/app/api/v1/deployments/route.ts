/**
 * REST: list and create deployments.
 *
 * A deployment connects an agent to a customer-facing surface. For surface='voice'
 * we also create a `voice_deployments` row with a public webhook token + signing
 * secret used by Twilio / outbound calling.
 *
 * Auth: session cookie (the dashboard) — bearer API key support is TODO and lives
 * alongside the same TODO in /api/v1/agents/route.ts.
 */
import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { agents, deployments, voiceDeployments } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { newId } from '@/server/ids';

const SURFACE_VALUES = ['voice', 'web', 'sms', 'custom'] as const;

const SurfacesShape = z
  .object({
    ivr: z.boolean().default(true),
    outbound: z.boolean().default(false),
    custom: z.boolean().default(false),
  })
  .partial()
  .default({ ivr: true });

const CreateSchema = z.object({
  agent_id: z.string().min(1), // external id (ag_…)
  surface: z.enum(SURFACE_VALUES),
  name: z.string().max(120).nullish(),
  config: z.record(z.unknown()).default({}),
  // voice-specific (ignored for non-voice surfaces)
  surfaces: SurfacesShape.optional(),
  voice_id: z.string().max(120).nullish(),
  speech_speed: z.number().min(0.5).max(2).optional(),
});

/**
 * Generate a URL-safe webhook token. Prefix `wsk_` so it's grep-able in logs and
 * unmistakable when pasted into a customer's Twilio console.
 */
function newWebhookToken(): string {
  // 18 bytes → 24 base64url chars; collision-resistant for our scale.
  return `wsk_${crypto.randomBytes(18).toString('base64url')}`;
}

/** HMAC signing secret. `whsec_` prefix matches Stripe/Svix conventions. */
function newSigningSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('base64url')}`;
}

export async function GET(req: Request) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const surface = url.searchParams.get('surface');

  const list = await withWorkspace(wsId, async (tx) => {
    const where = surface
      ? and(eq(deployments.workspaceId, wsId), eq(deployments.surface, surface))
      : eq(deployments.workspaceId, wsId);

    const rows = await tx
      .select({
        id: deployments.id,
        externalId: deployments.externalId,
        agentId: deployments.agentId,
        agentExternalId: agents.externalId,
        agentName: agents.name,
        agentVersion: agents.currentVersion,
        surface: deployments.surface,
        name: deployments.name,
        status: deployments.status,
        config: deployments.config,
        createdAt: deployments.createdAt,
        updatedAt: deployments.updatedAt,
        // voice-only fields (left-joined; null when surface != voice)
        webhookToken: voiceDeployments.webhookToken,
        surfaces: voiceDeployments.surfaces,
        voiceId: voiceDeployments.voiceId,
        speechSpeed: voiceDeployments.speechSpeed,
      })
      .from(deployments)
      .innerJoin(agents, eq(agents.id, deployments.agentId))
      .leftJoin(voiceDeployments, eq(voiceDeployments.deploymentId, deployments.id))
      .where(where)
      .orderBy(desc(deployments.createdAt));

    return rows;
  });

  return NextResponse.json({ deployments: list });
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
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const result = await withWorkspace(wsId, async (tx) => {
    // Resolve external agent id → numeric id (and verify it belongs to this workspace).
    const [agent] = await tx
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.workspaceId, wsId), eq(agents.externalId, data.agent_id)))
      .limit(1);
    if (!agent) return { error: 'agent not found' as const };

    const externalId = newId('sess'); // reuse a generic prefix; could add 'dep' to IdPrefix later
    const [dep] = await tx
      .insert(deployments)
      .values({
        externalId,
        workspaceId: wsId,
        agentId: agent.id,
        surface: data.surface,
        name: data.name ?? `${agent.name} — ${data.surface}`,
        status: 'active',
        config: data.config ?? {},
      })
      .returning();

    let voice: typeof voiceDeployments.$inferSelect | null = null;
    if (data.surface === 'voice') {
      const [v] = await tx
        .insert(voiceDeployments)
        .values({
          deploymentId: dep.id,
          workspaceId: wsId,
          webhookToken: newWebhookToken(),
          signingSecret: newSigningSecret(),
          surfaces: data.surfaces ?? { ivr: true, outbound: false, custom: false },
          voiceId: data.voice_id ?? null,
          speechSpeed: data.speech_speed ?? 1.0,
        })
        .returning();
      voice = v;
    }
    return { dep, voice };
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(
    {
      deployment: {
        ...result.dep,
        voice: result.voice,
      },
    },
    { status: 201 },
  );
}
