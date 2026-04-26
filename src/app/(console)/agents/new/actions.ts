'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { agentVersions, agents } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { newId } from '@/server/ids';
import { buildSystemPrompt } from '@/server/prompts';
import { defaultVoiceMap } from '@/lib/languages';

const PurposeEnum = z.enum(['support', 'lead-qual', 'booking', 'ivr', 'outbound', 'custom']);

const Schema = z.object({
  name: z.string().min(1).max(80),
  purpose: PurposeEnum,
  industry: z.string().max(80).optional().nullable(),
  audience: z.string().max(80).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  freeText: z.string().max(500).optional().nullable(),
  languages: z.array(z.string()).min(1, 'Pick at least one language.'),
  defaultLanguage: z.string(),
  autoDetectLanguage: z.boolean(),
});

export interface CreateAgentResult {
  ok?: boolean;
  agentExternalId?: string;
  error?: string;
}

export async function createAgentAction(
  input: z.infer<typeof Schema>,
): Promise<CreateAgentResult> {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return { error: 'Not signed in.' };

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' };
  const data = parsed.data;

  // Default language must be in the languages list.
  const defaultLanguage = data.languages.includes(data.defaultLanguage)
    ? data.defaultLanguage
    : data.languages[0];

  const systemPrompt = buildSystemPrompt({
    purpose: data.purpose,
    industry: data.industry,
    audience: data.audience,
    description: data.description,
    freeText: data.freeText,
    languages: data.languages,
    defaultLanguage,
  });

  const externalId = newId('ag');

  await withWorkspace(wsId, async (tx) => {
    const [agent] = await tx
      .insert(agents)
      .values({
        externalId,
        workspaceId: wsId,
        name: data.name,
        purpose: data.purpose,
        industry: data.industry ?? null,
        audience: data.audience ?? null,
        description: data.description ?? null,
        status: 'draft',
        currentVersion: 1,
      })
      .returning({ id: agents.id });

    await tx.insert(agentVersions).values({
      agentId: agent.id,
      version: 1,
      systemPrompt,
      languages: data.languages,
      defaultLanguage,
      autoDetectLanguage: data.autoDetectLanguage,
      voiceMap: defaultVoiceMap(data.languages),
    });
  });

  redirect(`/agents/${externalId}`);
}
