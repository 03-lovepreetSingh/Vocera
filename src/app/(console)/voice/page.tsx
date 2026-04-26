/**
 * Voice Agents — index of voice deployments for the current workspace.
 *
 * Shows: agent name + version, surface tags (IVR / Outbound / Custom), status,
 * created-at, and a deep link to the per-deployment setup page.
 */
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { Phone } from '@/components/icons';
import { withWorkspace } from '@/db/client';
import { agents, deployments, voiceDeployments } from '@/db/schema';
import { auth } from '@/server/auth/config';

interface SurfacesCfg {
  ivr?: boolean;
  outbound?: boolean;
  custom?: boolean;
}

export default async function VoiceAgentsPage() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const list = await withWorkspace(wsId, (tx) =>
    tx
      .select({
        id: deployments.id,
        externalId: deployments.externalId,
        name: deployments.name,
        status: deployments.status,
        createdAt: deployments.createdAt,
        agentName: agents.name,
        agentExternalId: agents.externalId,
        agentVersion: agents.currentVersion,
        webhookToken: voiceDeployments.webhookToken,
        surfaces: voiceDeployments.surfaces,
      })
      .from(deployments)
      .innerJoin(agents, eq(agents.id, deployments.agentId))
      .leftJoin(voiceDeployments, eq(voiceDeployments.deploymentId, deployments.id))
      .where(eq(deployments.workspaceId, wsId))
      .orderBy(desc(deployments.createdAt)),
  );

  // Filter to voice surface only — listing page is voice-specific.
  const voiceList = list.filter((d) => d.webhookToken !== null);

  return (
    <>
      <AppTopbar title="Voice Agents" />
      <main className="flex-1 px-6 py-6">
        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm text-ink-3">
            Phone-facing deployments. Each one wires an AI agent to a webhook URL you can paste
            into Twilio or call from your CRM.
          </p>
          <Link
            href="/voice/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper hover:opacity-90"
          >
            + New voice agent
          </Link>
        </div>

        {voiceList.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-soft bg-paper px-8 py-14 text-center">
            <Phone className="mx-auto h-8 w-8 text-ink-4" />
            <p className="mt-3 text-sm text-ink-3">
              No voice agents yet. Pick an AI agent and deploy it to a phone number.
            </p>
            <Link
              href="/voice/new"
              className="mt-4 inline-block rounded-md bg-accent px-4 py-2 font-medium text-paper"
            >
              Deploy your first voice agent
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3">
            {voiceList.map((d) => {
              const surfaces = (d.surfaces as SurfacesCfg | null) ?? {};
              const surfaceTags: string[] = [];
              if (surfaces.ivr) surfaceTags.push('IVR');
              if (surfaces.outbound) surfaceTags.push('Outbound');
              if (surfaces.custom) surfaceTags.push('Custom');
              return (
                <li
                  key={d.externalId}
                  className="flex items-center justify-between rounded-lg border border-line-soft bg-paper px-5 py-4"
                >
                  <Link
                    href={`/voice/${d.externalId}`}
                    className="flex min-w-0 flex-1 items-center gap-4 hover:text-accent"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-soft">
                      <Phone className="h-4 w-4 text-accent" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{d.name ?? d.agentName}</div>
                      <div className="mt-0.5 truncate text-xs text-ink-3">
                        <span>{d.agentName}</span>
                        <span className="mx-1.5 text-ink-4">·</span>
                        <span>v{d.agentVersion}</span>
                        <span className="mx-1.5 text-ink-4">·</span>
                        <span className="capitalize">{d.status}</span>
                        {surfaceTags.length > 0 && (
                          <>
                            <span className="mx-1.5 text-ink-4">·</span>
                            <span>{surfaceTags.join(' / ')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-3 text-xs text-ink-3">
                    {d.webhookToken && (
                      <span className="hidden rounded bg-fill px-2 py-1 font-mono text-[10px] sm:inline">
                        {d.webhookToken.slice(0, 14)}…
                      </span>
                    )}
                    <Link
                      href={`/voice/${d.externalId}`}
                      className="hover:text-ink"
                    >
                      Open →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
