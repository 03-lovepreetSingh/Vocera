import { withWorkspace } from '@/db/client';
import { agentVersions, agents } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { VoiceSettings } from '../VoiceSettings';

/**
 * Voice tab — voice gallery + speech-speed slider + per-language voice map.
 * Saving forks a new agent_version (handled server-side by PATCH route).
 */
export default async function AgentVoicePage({ params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const data = await withWorkspace(wsId, async (tx) => {
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

  if (!data || !data.version) return notFound();

  return (
    <div className="px-6 py-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Voice settings</h2>
        <p className="text-sm text-ink-3">Pick a voice and shape how it speaks.</p>
      </div>

      <div className="mx-auto max-w-[860px]">
        <VoiceSettings
          agentExternalId={data.agent.externalId}
          languages={(data.version.languages as string[]) ?? ['en-US']}
          initialVoiceMap={(data.version.voiceMap as Record<string, string>) ?? {}}
          initialSpeed={data.version.speechSpeed}
        />
      </div>
    </div>
  );
}
