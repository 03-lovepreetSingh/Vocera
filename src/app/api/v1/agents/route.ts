/**
 * REST: list and create agents.
 * Auth: bearer API key (TODO: validate against api_keys.hash).
 *       For now we authenticate with the session cookie too, so the dashboard
 *       can call this API directly.
 */
import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withWorkspace } from '@/db/client';
import { agents, agentVersions } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { newId } from '@/server/ids';
import { buildSystemPrompt } from '@/server/prompts';
import { defaultVoiceMap } from '@/lib/languages';

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  purpose: z.enum(['support', 'lead-qual', 'booking', 'ivr', 'outbound', 'custom']),
  industry: z.string().max(80).nullish(),
  audience: z.string().max(80).nullish(),
  description: z.string().max(2000).nullish(),
  languages: z.array(z.string()).min(1),
  defaultLanguage: z.string(),
  autoDetectLanguage: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const list = await withWorkspace(wsId, (tx) =>
    tx.select().from(agents).where(eq(agents.workspaceId, wsId)).orderBy(desc(agents.createdAt)),
  );
  return NextResponse.json({ agents: list });
}

export async function POST(req: Request) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const defaultLanguage = data.languages.includes(data.defaultLanguage)
    ? data.defaultLanguage
    : data.languages[0];

  const externalId = newId('ag');

  const created = await withWorkspace(wsId, async (tx) => {
    const [a] = await tx
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
      .returning();
    await tx.insert(agentVersions).values({
      agentId: a.id,
      version: 1,
      systemPrompt: buildSystemPrompt({ ...data, defaultLanguage }),
      languages: data.languages,
      defaultLanguage,
      autoDetectLanguage: data.autoDetectLanguage,
      voiceMap: defaultVoiceMap(data.languages),
    });
    return a;
  });

  return NextResponse.json({ agent: created }, { status: 201 });
}
