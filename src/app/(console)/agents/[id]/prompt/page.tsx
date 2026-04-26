import { withWorkspace } from '@/db/client';
import { agentVersions, agents } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { PromptEditor } from '../PromptEditor';

/**
 * Prompt tab — large monospace editor for the system prompt + a placeholder
 * "golden tests" panel. Saving forks a new agent_version and bumps
 * agents.current_version (handled by PATCH /api/v1/agents/[id]).
 */
export default async function AgentPromptPage({ params }: { params: { id: string } }) {
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
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">Prompt</h2>
          <p className="text-sm text-ink-3">
            Instructions the model follows on every call. Saving forks a new version.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-[860px] grid gap-6">
        <PromptEditor
          agentExternalId={data.agent.externalId}
          version={data.agent.currentVersion}
          initialPrompt={data.version.systemPrompt}
        />

        <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Golden test cases</div>
              <div className="text-xs text-ink-3">
                Lock behavior in place — runs every test before promoting a new version.
              </div>
            </div>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="cursor-not-allowed rounded-md border border-line-soft bg-paper px-3 py-1.5 text-xs text-ink-3"
            >
              + Add test
            </button>
          </div>
          <div className="mt-3 rounded-md border border-dashed border-line-soft bg-fill px-4 py-6 text-center text-xs text-ink-3">
            No golden tests yet. Once you add one, every save will run them and surface regressions
            before they hit production.
          </div>
        </div>
      </div>
    </div>
  );
}
