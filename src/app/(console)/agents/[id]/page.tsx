import { and, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { TalkButton } from '@/components/voice/TalkButton';
import { KnowledgeUploader } from '@/components/knowledge/KnowledgeUploader';
import { withWorkspace } from '@/db/client';
import { agentVersions, agents, knowledgeFiles } from '@/db/schema';
import { auth } from '@/server/auth/config';

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
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
    <>
      <AppTopbar title={agent.name} />
      <main className="flex-1 px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="grid gap-6">
            <Card title="Overview">
              <Pair k="Purpose" v={agent.purpose} />
              <Pair k="Status" v={agent.status} />
              <Pair k="Version" v={`v${agent.currentVersion}`} />
              <Pair k="Languages" v={(version?.languages ?? []).join(', ') || '—'} />
              <Pair k="Default language" v={version?.defaultLanguage ?? '—'} />
              <Pair k="Auto-detect" v={version?.autoDetectLanguage ? 'on' : 'off'} />
            </Card>

            <Card title="System prompt">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-fill p-3 font-mono text-xs">
                {version?.systemPrompt}
              </pre>
            </Card>

            <Card title="Knowledge base">
              <KnowledgeUploader agentExternalId={agent.externalId} files={files.map((f) => ({
                externalId: f.externalId,
                filename: f.filename,
                status: f.status,
                chunkCount: f.chunkCount,
              }))} />
            </Card>
          </section>

          <aside className="grid gap-6">
            <Card title="Talk to agent (test)">
              <TalkButton agentExternalId={agent.externalId} />
              <p className="mt-3 text-xs text-ink-3">
                Speak in {(version?.languages ?? []).join(' / ')}. Response should arrive in
                under a second.
              </p>
            </Card>
          </aside>
        </div>
      </main>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line-soft bg-paper px-5 py-4">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function Pair({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 border-b border-line-soft py-2 text-sm last:border-b-0">
      <span className="text-ink-3">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
