/**
 * Voice agent setup — the per-deployment configuration view.
 *
 * Layout matches the v2 design (`VoiceAgentSetup` in v2-pages.jsx):
 *   • Two-column 1.4 : 1 grid
 *   • LEFT  — numbered config cards (agent picker, test, lead capture, voice/lang)
 *   • RIGHT — integration: usage checkboxes, IVR webhook URL, outbound, custom
 *
 * Server component fetches the deployment + agent + version + lead fields in one
 * RLS-fenced transaction; interactive bits (copy buttons, secret reveal, surface
 * toggle) live in `VoiceSetupClient`.
 */
import { and, asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, Phone } from '@/components/icons';
import { withWorkspace } from '@/db/client';
import {
  agentLeadFields,
  agentVersions,
  agents,
  deployments,
  voiceDeployments,
} from '@/db/schema';
import { auth } from '@/server/auth/config';
import { LANGUAGES } from '@/lib/languages';
import { VoiceSetupClient } from './client';

interface SurfaceFlags {
  ivr?: boolean;
  outbound?: boolean;
  custom?: boolean;
}

// Public webhook host — falls back to voice.vocera.ai for the design's mock URL.
// Override in production via env.
const WEBHOOK_HOST = process.env.NEXT_PUBLIC_VOICE_WEBHOOK_HOST ?? 'https://voice.vocera.ai';

export default async function VoiceSetupPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const data = await withWorkspace(wsId, async (tx) => {
    const [row] = await tx
      .select({
        dep: deployments,
        voice: voiceDeployments,
        agent: agents,
      })
      .from(deployments)
      .innerJoin(agents, eq(agents.id, deployments.agentId))
      .leftJoin(voiceDeployments, eq(voiceDeployments.deploymentId, deployments.id))
      .where(
        and(eq(deployments.workspaceId, wsId), eq(deployments.externalId, params.id)),
      )
      .limit(1);

    if (!row) return null;

    const [version] = await tx
      .select()
      .from(agentVersions)
      .where(
        and(
          eq(agentVersions.agentId, row.agent.id),
          eq(agentVersions.version, row.agent.currentVersion),
        ),
      )
      .limit(1);

    const leadFields = await tx
      .select()
      .from(agentLeadFields)
      .where(eq(agentLeadFields.agentId, row.agent.id))
      .orderBy(asc(agentLeadFields.displayOrder));

    // For the agent-switcher dropdown.
    const allAgents = await tx
      .select({
        externalId: agents.externalId,
        name: agents.name,
        purpose: agents.purpose,
        currentVersion: agents.currentVersion,
      })
      .from(agents)
      .where(eq(agents.workspaceId, wsId));

    return { ...row, version, leadFields, allAgents };
  });

  if (!data) return notFound();
  if (data.dep.surface !== 'voice') {
    // Future surfaces (web, sms) will route to their own setup page.
    return notFound();
  }

  const { dep, voice, agent, version, leadFields, allAgents } = data;
  const surfaces = (voice?.surfaces as SurfaceFlags | null) ?? { ivr: true };
  const webhookToken = voice?.webhookToken ?? '';
  const ivrUrl = `${WEBHOOK_HOST}/ivr/${webhookToken}`;
  const customUrl = `${WEBHOOK_HOST}/api/${webhookToken}`;

  // Fall back to default lead-capture questions when an agent has none defined yet.
  const defaultLeadFields = [
    { fieldKey: 'name', fieldLabel: 'Caller name', fieldType: 'string', required: true, options: null },
    {
      fieldKey: 'phone',
      fieldLabel: 'Phone number (confirmation)',
      fieldType: 'phone',
      required: true,
      options: null,
    },
    { fieldKey: 'email', fieldLabel: 'Email', fieldType: 'email', required: false, options: null },
    {
      fieldKey: 'inquiry',
      fieldLabel: 'Issue or inquiry',
      fieldType: 'long-text',
      required: true,
      options: null,
    },
  ];
  const fields = leadFields.length > 0 ? leadFields : defaultLeadFields;

  const versionLanguages = version?.languages ?? ['en-US'];
  const defaultLang = version?.defaultLanguage ?? 'en-US';

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-line-soft bg-paper px-6">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/voice" className="text-ink-3 hover:text-ink">
            Voice Agents
          </Link>
          <span className="text-ink-4">/</span>
          <span className="font-semibold">{dep.name ?? agent.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/agents/${agent.externalId}`}
            className="rounded-md border border-line-soft px-3 py-1.5 text-xs hover:bg-fill"
          >
            Open AI agent
          </Link>
          <span
            className={`rounded-md px-2 py-1 text-[11px] font-medium ${
              dep.status === 'active'
                ? 'bg-accent-soft text-accent'
                : 'bg-fill text-ink-3'
            }`}
          >
            {dep.status}
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-auto px-6 py-6">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          {/* ─────────── LEFT: configuration ─────────── */}
          <div className="grid gap-4">
            {/* 1 — Pick AI agent */}
            <Card>
              <div className="mb-1 text-sm font-semibold">1 · Select an AI agent</div>
              <p className="mb-3 text-xs text-ink-3">The brain behind this voice agent.</p>

              <Link
                href={`/agents/${agent.externalId}`}
                className="flex items-center justify-between rounded-md border border-line-soft bg-paper px-3 py-2 hover:border-accent"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <Phone className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{agent.name}</div>
                    <div className="text-[11px] text-ink-3">
                      {agent.purpose} · v{agent.currentVersion}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-ink-3" />
              </Link>

              {allAgents.length > 1 && (
                <details className="mt-3 text-xs text-ink-3">
                  <summary className="cursor-pointer hover:text-ink">
                    Switch to a different agent
                  </summary>
                  <ul className="mt-2 grid gap-1.5">
                    {allAgents
                      .filter((a) => a.externalId !== agent.externalId)
                      .map((a) => (
                        <li key={a.externalId}>
                          <span className="text-ink-3">
                            {a.name} (v{a.currentVersion})
                          </span>
                          {' — '}
                          <span className="text-ink-4">
                            switching is coming soon; for now create a new deployment.
                          </span>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </Card>

            {/* 2 — Test it */}
            <Card className="bg-gradient-to-br from-accent-soft to-transparent">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold">2 · Test it</div>
                  <p className="text-xs text-ink-3">Talk to the agent right in your browser.</p>
                </div>
                <span className="rounded-md bg-paper px-2 py-0.5 text-[10px] text-ink-3">
                  browser test
                </span>
              </div>

              <div className="flex items-center gap-3 py-2">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-paper">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </svg>
                </div>

                <div className="flex-1">
                  <Waveform />
                  <p className="mt-1 text-[11px] text-ink-3">
                    The full mic loop runs on the AI-agent page (audio worklet, STT, TTS).
                  </p>
                </div>

                <Link
                  href={`/agents/${agent.externalId}`}
                  className="rounded-md border border-line-soft bg-paper px-3 py-1.5 text-xs hover:bg-fill"
                >
                  Open test →
                </Link>
              </div>
            </Card>

            {/* 3 — Lead capture questions */}
            <Card>
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold">3 · Lead capture questions</div>
                  <p className="text-xs text-ink-3">
                    What should the agent ask to qualify the caller?
                  </p>
                </div>
                <button
                  type="button"
                  disabled
                  className="rounded-md border border-line-soft bg-paper px-2.5 py-1 text-[11px] text-ink-3 disabled:cursor-not-allowed"
                  title="Edit questions on the AI-agent page"
                >
                  + Add question
                </button>
              </div>

              <ul>
                {fields.map((f, i) => (
                  <li
                    key={`${f.fieldKey}-${i}`}
                    className={`grid grid-cols-[20px_1fr_auto_auto] items-center gap-3 py-2 text-[13px] ${
                      i > 0 ? 'border-t border-line-softer' : ''
                    }`}
                  >
                    <span className="cursor-grab text-ink-4" aria-hidden>
                      ⋮⋮
                    </span>
                    <div>
                      <div className="font-medium">{f.fieldLabel}</div>
                      {f.options ? (
                        <div className="text-[11px] text-ink-3">
                          {Array.isArray(f.options)
                            ? f.options.join(' / ')
                            : JSON.stringify(f.options)}
                        </div>
                      ) : null}
                    </div>
                    <span className="rounded bg-fill px-1.5 py-0.5 text-[10px] text-ink-3">
                      {f.fieldType}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        f.required ? 'bg-accent-soft text-accent' : 'bg-fill text-ink-3'
                      }`}
                    >
                      {f.required ? 'required' : 'optional'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {/* 4 — Voice & language */}
            <Card>
              <div className="mb-3 text-sm font-semibold">4 · Voice & language</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Voice">
                  <FakeSelect value={voice?.voiceId ?? 'Default · per-language'} />
                </Field>
                <Field label="Language">
                  <FakeSelect
                    value={
                      LANGUAGES.find((l) => l.code === defaultLang)?.label ?? defaultLang
                    }
                  />
                </Field>
                <Field label="Speed">
                  <FakeSelect value={`${(voice?.speechSpeed ?? 1).toFixed(1)}×`} />
                </Field>
              </div>
              {versionLanguages.length > 1 && (
                <p className="mt-3 text-[11px] text-ink-3">
                  Multilingual: {versionLanguages.join(' / ')}.{' '}
                  {version?.autoDetectLanguage
                    ? 'Auto-detect on.'
                    : 'Caller-language pinned.'}
                </p>
              )}
            </Card>
          </div>

          {/* ─────────── RIGHT: integration ─────────── */}
          <VoiceSetupClient
            deploymentExternalId={dep.externalId}
            initialSurfaces={{
              ivr: !!surfaces.ivr,
              outbound: !!surfaces.outbound,
              custom: !!surfaces.custom,
            }}
            ivrUrl={ivrUrl}
            customUrl={customUrl}
            agentExternalId={agent.externalId}
            signingSecret={voice?.signingSecret ?? ''}
          />
        </div>
      </main>
    </>
  );
}

function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line-soft bg-paper p-5 ${className}`}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      {children}
    </div>
  );
}

function FakeSelect({ value }: { value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-line-soft bg-paper px-3 py-2 text-sm">
      <span className="truncate">{value}</span>
      <ChevronRight className="h-3 w-3 rotate-90 text-ink-3" />
    </div>
  );
}

/**
 * Static SVG waveform — purely decorative. Real visualization is in TalkButton.
 * The bar pattern is deterministic so it doesn't shift between server/client renders.
 */
function Waveform() {
  const bars = 60;
  // Pseudo-random heights using a fixed seed so SSR matches client.
  const heights = Array.from({ length: bars }, (_, i) => {
    const h = (Math.sin(i * 1.7) + 1) * 12 + 6 + ((i * 13) % 7);
    return Math.round(h);
  });
  return (
    <svg
      width="100%"
      height="36"
      viewBox={`0 0 ${bars * 6} 36`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 6}
          y={(36 - h) / 2}
          width="3"
          height={h}
          rx="1.5"
          className="fill-accent/60"
        />
      ))}
    </svg>
  );
}
