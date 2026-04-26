/**
 * One-shot script: rebuild system prompts for all existing agents using the
 * latest buildSystemPrompt template. Run after editing prompts.ts so existing
 * agents pick up the new persona/style without recreating them.
 *
 *   tsx scripts/refresh-prompts.ts
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { agents, agentVersions } from '../src/db/schema';
import { buildSystemPrompt } from '../src/server/prompts';

const list = await db
  .select({
    agentId: agents.id,
    externalId: agents.externalId,
    name: agents.name,
    purpose: agents.purpose,
    industry: agents.industry,
    audience: agents.audience,
    description: agents.description,
  })
  .from(agents);

for (const a of list) {
  const versions = await db
    .select()
    .from(agentVersions)
    .where(eq(agentVersions.agentId, a.agentId));
  for (const v of versions) {
    const newPrompt = buildSystemPrompt({
      purpose: a.purpose,
      industry: a.industry,
      audience: a.audience,
      description: a.description,
      languages: v.languages,
      defaultLanguage: v.defaultLanguage,
    });
    await db
      .update(agentVersions)
      .set({ systemPrompt: newPrompt })
      .where(eq(agentVersions.id, v.id));
  }
  console.log('updated', a.externalId, '/', a.name);
}
console.log('done.');
process.exit(0);
