/**
 * REST: get / update / delete a single deployment.
 *
 * `id` is the deployment external id.
 *
 * PATCH supports partial updates of:
 *   - name, status, config            (deployments)
 *   - surfaces, voice_id, speech_speed (voice_deployments — voice surface only)
 *   - rotate_secret: true             — issues a new HMAC signing secret
 *   - rotate_token: true              — issues a new public webhook token (breaks existing Twilio config!)
 */
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { agents, deployments, voiceDeployments } from '@/db/schema';
import { auth } from '@/server/auth/config';

const SurfacesShape = z
  .object({
    ivr: z.boolean(),
    outbound: z.boolean(),
    custom: z.boolean(),
  })
  .partial();

const PatchSchema = z.object({
  name: z.string().max(120).nullish(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  config: z.record(z.unknown()).optional(),
  surfaces: SurfacesShape.optional(),
  voice_id: z.string().max(120).nullish(),
  speech_speed: z.number().min(0.5).max(2).optional(),
  rotate_secret: z.boolean().optional(),
  rotate_token: z.boolean().optional(),
});

function newWebhookToken(): string {
  return `wsk_${crypto.randomBytes(18).toString('base64url')}`;
}

function newSigningSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('base64url')}`;
}

/** Hydrate a deployment + (optional) voice row by external id, scoped to the workspace. */
async function loadDeployment(wsId: number, externalId: string) {
  return withWorkspace(wsId, async (tx) => {
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
        voiceId: voiceDeployments.voiceId,
        speechSpeed: voiceDeployments.speechSpeed,
        webhookToken: voiceDeployments.webhookToken,
        signingSecret: voiceDeployments.signingSecret,
        surfaces: voiceDeployments.surfaces,
      })
      .from(deployments)
      .innerJoin(agents, eq(agents.id, deployments.agentId))
      .leftJoin(voiceDeployments, eq(voiceDeployments.deploymentId, deployments.id))
      .where(
        and(eq(deployments.workspaceId, wsId), eq(deployments.externalId, externalId)),
      )
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const dep = await loadDeployment(wsId, params.id);
  if (!dep) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ deployment: dep });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const patch = parsed.data;

  const updated = await withWorkspace(wsId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(deployments)
      .where(
        and(eq(deployments.workspaceId, wsId), eq(deployments.externalId, params.id)),
      )
      .limit(1);
    if (!existing) return null;

    // Build only the fields actually provided. Drizzle doesn't accept undefineds in
    // .set() if the column is .notNull() — so we conditionally include each key.
    const depPatch: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) depPatch.name = patch.name;
    if (patch.status !== undefined) depPatch.status = patch.status;
    if (patch.config !== undefined) depPatch.config = patch.config;

    if (Object.keys(depPatch).length > 1) {
      await tx.update(deployments).set(depPatch).where(eq(deployments.id, existing.id));
    }

    if (existing.surface === 'voice') {
      const voicePatch: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.surfaces !== undefined) {
        // Merge with existing surfaces so partial updates don't drop unspecified keys.
        const [cur] = await tx
          .select({ surfaces: voiceDeployments.surfaces })
          .from(voiceDeployments)
          .where(eq(voiceDeployments.deploymentId, existing.id))
          .limit(1);
        voicePatch.surfaces = { ...(cur?.surfaces as object | null ?? {}), ...patch.surfaces };
      }
      if (patch.voice_id !== undefined) voicePatch.voiceId = patch.voice_id;
      if (patch.speech_speed !== undefined) voicePatch.speechSpeed = patch.speech_speed;
      if (patch.rotate_secret) voicePatch.signingSecret = newSigningSecret();
      if (patch.rotate_token) voicePatch.webhookToken = newWebhookToken();

      if (Object.keys(voicePatch).length > 1) {
        await tx
          .update(voiceDeployments)
          .set(voicePatch)
          .where(eq(voiceDeployments.deploymentId, existing.id));
      }
    }

    return existing;
  });

  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const fresh = await loadDeployment(wsId, params.id);
  return NextResponse.json({ deployment: fresh });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const removed = await withWorkspace(wsId, async (tx) => {
    const result = await tx
      .delete(deployments)
      .where(
        and(eq(deployments.workspaceId, wsId), eq(deployments.externalId, params.id)),
      )
      .returning({ id: deployments.id });
    return result[0] ?? null;
  });

  if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
