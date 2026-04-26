import { KnowledgeUploader } from '@/components/knowledge/KnowledgeUploader';
import { TalkButton } from '@/components/voice/TalkButton';
import { withWorkspace } from '@/db/client';
import { agentVersions, agents, knowledgeFiles } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { and, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { BasicInfoForm } from './BasicInfoForm';

/**
 * Basic Info tab — the default landing for an agent's builder.
 *
 * Shows an editable form for the non-versioned `agents` row (name / purpose /
 * industry / audience / status), the language list + default + auto-detect
 * (versioned — saving forks a new version), the Knowledge upload card, and a
 * sidebar Talk-to-agent test panel. Topbar + sub-nav are owned by the parent
 * layout; this page focuses purely on Basic Info content.
 */
export default async function AgentBasicInfoPage({ params }: { params: { id: string } }) {
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

    const files = await tx
      .select()
      .from(knowledgeFiles)
      .where(eq(knowledgeFiles.agentId, agent.id))
      .orderBy(desc(knowledgeFiles.createdAt));

    return { agent, version, files };
  });

  if (!data) return notFound();

  const { agent, version, files } = data;

  return (
    <div className="px-6 py-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Basic info</h2>
        <p className="text-sm text-ink-3">
          Who the agent is, who it talks to, and which languages it speaks.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="grid gap-6">
          <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
            <BasicInfoForm
              agentExternalId={agent.externalId}
              initial={{
                name: agent.name,
                purpose: agent.purpose,
                industry: agent.industry ?? '',
                audience: agent.audience ?? '',
                description: agent.description ?? '',
                status: (agent.status as 'draft' | 'live') ?? 'draft',
                languages: (version?.languages as string[]) ?? ['en-US'],
                defaultLanguage: version?.defaultLanguage ?? 'en-US',
                autoDetectLanguage: version?.autoDetectLanguage ?? true,
              }}
            />
          </div>

          <div id="knowledge" className="rounded-lg border border-line-soft bg-paper px-5 py-4">
            <div className="mb-3 text-sm font-semibold">Knowledge base</div>
            <KnowledgeUploader
              agentExternalId={agent.externalId}
              files={files.map((f) => ({
                externalId: f.externalId,
                filename: f.filename,
                status: f.status,
                chunkCount: f.chunkCount,
              }))}
            />
          </div>
        </section>

        <aside className="grid h-fit gap-6">
          <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
            <div className="mb-3 text-sm font-semibold">Talk to agent (test)</div>
            <TalkButton agentExternalId={agent.externalId} />
            <p className="mt-3 text-xs text-ink-3">
              Speak in {((version?.languages as string[]) ?? []).join(' / ')}. Response should
              arrive in under a second.
            </p>
          </div>
          <div className="rounded-lg border border-line-soft bg-paper px-5 py-4 text-xs text-ink-3">
            <div className="mb-1 font-medium text-ink-2">Version</div>
            <div>
              v{agent.currentVersion} · {agent.status}
            </div>
            <div className="mt-2">
              Editing prompt or voice settings creates a new version automatically.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
