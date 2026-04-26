import { withWorkspace } from '@/db/client';
import { agentVersions, agents } from '@/db/schema';
import { LANGUAGES } from '@/lib/languages';
import { auth } from '@/server/auth/config';
/**
 * REST: read + patch a single agent.
 *
 * GET   → returns the agent + its current version (used by client tabs).
 * PATCH → updates Basic Info OR creates a new agent_version when prompt /
 *         voice settings change. Versions are immutable: any edit to a
 *         versioned field forks a new row and bumps `agents.current_version`.
 *
 * Auth: session cookie (dashboard). API key auth can be layered on later.
 *
 * Versioned fields (any change → new row in agent_versions):
 *   - systemPrompt
 *   - voiceMap
 *   - speechSpeed
 *   - languages
 *   - defaultLanguage
 *   - autoDetectLanguage
 *
 * Non-versioned fields (mutate the `agents` row in place):
 *   - name
 *   - purpose
 *   - industry
 *   - audience
 *   - description
 *   - status
 */
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const VALID_LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

const PatchSchema = z
  .object({
    // Basic info (mutate agents row in place)
    name: z.string().min(1).max(80).optional(),
    purpose: z.enum(['support', 'lead-qual', 'booking', 'ivr', 'outbound', 'custom']).optional(),
    industry: z.string().max(80).nullish(),
    audience: z.string().max(80).nullish(),
    description: z.string().max(2000).nullish(),
    status: z.enum(['draft', 'live']).optional(),

    // Versioned (fork a new agent_version row)
    systemPrompt: z.string().min(1).max(32_000).optional(),
    voiceMap: z.record(z.string(), z.string()).optional(),
    speechSpeed: z.number().min(0.5).max(2.0).optional(),
    languages: z.array(z.string()).min(1).max(32).optional(),
    defaultLanguage: z.string().optional(),
    autoDetectLanguage: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const VERSIONED_KEYS = [
  'systemPrompt',
  'voiceMap',
  'speechSpeed',
  'languages',
  'defaultLanguage',
  'autoDetectLanguage',
] as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await withWorkspace(wsId, async (tx) => {
    const [agent] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, wsId), eq(agents.externalId, params.id)))
      .limit(1);
    if (!agent) return null;
    const [version] = await tx
      .select()
      .from(agentVersions)
      .where(
        and(eq(agentVersions.agentId, agent.id), eq(agentVersions.version, agent.currentVersion)),
      )
      .limit(1);
    return { agent, version };
  });

  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Cross-field validation for languages / defaultLanguage.
  if (data.languages) {
    for (const code of data.languages) {
      if (!VALID_LANGUAGE_CODES.has(code)) {
        return NextResponse.json({ error: `unsupported_language:${code}` }, { status: 400 });
      }
    }
  }

  const result = await withWorkspace(wsId, async (tx) => {
    const [agent] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, wsId), eq(agents.externalId, params.id)))
      .limit(1);
    if (!agent) return { error: 'not_found' as const };

    const [currentVersion] = await tx
      .select()
      .from(agentVersions)
      .where(
        and(eq(agentVersions.agentId, agent.id), eq(agentVersions.version, agent.currentVersion)),
      )
      .limit(1);
    if (!currentVersion) return { error: 'not_found' as const };

    // 1) Patch the agents row in place for non-versioned fields.
    const agentPatch: Partial<typeof agents.$inferInsert> = { updatedAt: new Date() };
    let agentDirty = false;
    if (data.name !== undefined) {
      agentPatch.name = data.name;
      agentDirty = true;
    }
    if (data.purpose !== undefined) {
      agentPatch.purpose = data.purpose;
      agentDirty = true;
    }
    if (data.industry !== undefined) {
      agentPatch.industry = data.industry ?? null;
      agentDirty = true;
    }
    if (data.audience !== undefined) {
      agentPatch.audience = data.audience ?? null;
      agentDirty = true;
    }
    if (data.description !== undefined) {
      agentPatch.description = data.description ?? null;
      agentDirty = true;
    }
    if (data.status !== undefined) {
      agentPatch.status = data.status;
      agentDirty = true;
    }

    // 2) Determine if any versioned field changed.
    const versionDirty = VERSIONED_KEYS.some((k) => {
      if (!(k in data) || data[k] === undefined) return false;
      switch (k) {
        case 'systemPrompt':
          return data.systemPrompt !== currentVersion.systemPrompt;
        case 'speechSpeed':
          return data.speechSpeed !== currentVersion.speechSpeed;
        case 'defaultLanguage':
          return data.defaultLanguage !== currentVersion.defaultLanguage;
        case 'autoDetectLanguage':
          return data.autoDetectLanguage !== currentVersion.autoDetectLanguage;
        case 'languages':
          return (
            JSON.stringify(data.languages ?? []) !== JSON.stringify(currentVersion.languages ?? [])
          );
        case 'voiceMap':
          return (
            JSON.stringify(data.voiceMap ?? {}) !== JSON.stringify(currentVersion.voiceMap ?? {})
          );
      }
    });

    let nextVersion = agent.currentVersion;

    if (versionDirty) {
      const newLanguages = data.languages ?? (currentVersion.languages as string[]);
      const candidateDefault = data.defaultLanguage ?? currentVersion.defaultLanguage;
      const newDefault = newLanguages.includes(candidateDefault)
        ? candidateDefault
        : newLanguages[0];

      // Filter voiceMap to only languages that are still enabled, so we never
      // carry orphan entries forward.
      const baseVoiceMap =
        data.voiceMap ?? (currentVersion.voiceMap as Record<string, string>) ?? {};
      const newVoiceMap: Record<string, string> = {};
      for (const code of newLanguages) {
        if (baseVoiceMap[code]) newVoiceMap[code] = baseVoiceMap[code];
      }

      nextVersion = agent.currentVersion + 1;

      await tx.insert(agentVersions).values({
        agentId: agent.id,
        version: nextVersion,
        systemPrompt: data.systemPrompt ?? currentVersion.systemPrompt,
        llmModel: currentVersion.llmModel,
        llmTemperature: currentVersion.llmTemperature,
        voiceProvider: currentVersion.voiceProvider,
        voiceMap: newVoiceMap,
        languages: newLanguages,
        defaultLanguage: newDefault,
        autoDetectLanguage: data.autoDetectLanguage ?? currentVersion.autoDetectLanguage,
        speechSpeed: data.speechSpeed ?? currentVersion.speechSpeed,
        tools: currentVersion.tools,
      });

      agentPatch.currentVersion = nextVersion;
      agentDirty = true;
    }

    if (agentDirty) {
      await tx.update(agents).set(agentPatch).where(eq(agents.id, agent.id));
    }

    return { ok: true as const, currentVersion: nextVersion, versionBumped: versionDirty };
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(result);
}
