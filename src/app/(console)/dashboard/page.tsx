import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import Link from 'next/link';
import { AppTopbar } from '@/components/layout/AppTopbar';
import { withWorkspace } from '@/db/client';
import { agents, conversations, knowledgeFiles } from '@/db/schema';
import { auth } from '@/server/auth/config';

type AgentRow = {
  id: number;
  externalId: string;
  name: string;
  purpose: string;
  status: string;
  currentVersion: number;
  docCount: number;
};

type VoiceAgentRow = AgentRow & {
  phoneNumber: string | null;
  mode: string;
  callCount: number;
};

type ConversationRow = {
  id: number;
  externalId: string;
  callerId: string | null;
  callerName: string | null;
  agentName: string | null;
  intent: string | null;
  durationMs: number | null;
  startedAt: Date;
  status: string;
};

export default async function DashboardPage(props: { searchParams: { onboarding?: string } }) {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  if (!wsId) return null;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const data = await withWorkspace(wsId, async (tx) => {
    // All agents in workspace (with doc counts) — limited list for AI agents UI
    const agentRows = await tx
      .select({
        id: agents.id,
        externalId: agents.externalId,
        name: agents.name,
        purpose: agents.purpose,
        status: agents.status,
        currentVersion: agents.currentVersion,
        docCount: sql<number>`COALESCE((
          SELECT COUNT(*) FROM ${knowledgeFiles}
          WHERE ${knowledgeFiles.agentId} = ${agents.id}
        ), 0)`.as('doc_count'),
      })
      .from(agents)
      .where(eq(agents.workspaceId, wsId))
      .orderBy(desc(agents.createdAt))
      .limit(20);

    // Voice agents — derived from agents with voice-flavored purposes
    // Phone number / mode are placeholders until a voice_agents table exists.
    // TODO: replace with real voice_agent rows when that table lands.
    const voicePurposes = new Set(['ivr', 'outbound', 'voice', 'support']);
    const voiceAgents: VoiceAgentRow[] = agentRows
      .filter((a) => voicePurposes.has(a.purpose))
      .slice(0, 5)
      .map((a) => ({
        ...a,
        phoneNumber: null, // TODO: from voice_agents.phone_number
        mode:
          a.purpose === 'outbound'
            ? 'outbound'
            : a.purpose === 'ivr'
              ? 'IVR · inbound'
              : 'custom',
        callCount: 0, // filled below
      }));

    // Recent conversations + agent name
    const recent = await tx
      .select({
        id: conversations.id,
        externalId: conversations.externalId,
        callerId: conversations.callerId,
        callerName: conversations.callerName,
        agentName: agents.name,
        intent: conversations.intent,
        durationMs: conversations.durationMs,
        startedAt: conversations.startedAt,
        status: conversations.status,
      })
      .from(conversations)
      .leftJoin(agents, eq(agents.id, conversations.agentId))
      .where(eq(conversations.workspaceId, wsId))
      .orderBy(desc(conversations.startedAt))
      .limit(10);

    // Stats — counts and aggregates
    const [convTotal] = await tx
      .select({ value: count() })
      .from(conversations)
      .where(eq(conversations.workspaceId, wsId));

    const [convMtd] = await tx
      .select({ value: count() })
      .from(conversations)
      .where(
        and(eq(conversations.workspaceId, wsId), gte(conversations.startedAt, monthStart)),
      );

    const [leadsMtd] = await tx
      .select({ value: count() })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, wsId),
          gte(conversations.startedAt, monthStart),
          eq(conversations.status, 'completed'),
        ),
      );

    const [activeAgents] = await tx
      .select({ value: count() })
      .from(agents)
      .where(and(eq(agents.workspaceId, wsId), eq(agents.status, 'live')));

    const [totalAgents] = await tx
      .select({ value: count() })
      .from(agents)
      .where(eq(agents.workspaceId, wsId));

    // Spend MTD — derived from token usage as a placeholder until usage_events lands.
    // TODO: replace with SUM(amount_cents) FROM usage_events WHERE billing_period = current.
    const [tokenSums] = await tx
      .select({
        inTok: sql<number>`COALESCE(SUM(${conversations.llmInputTokens}), 0)`,
        outTok: sql<number>`COALESCE(SUM(${conversations.llmOutputTokens}), 0)`,
      })
      .from(conversations)
      .where(
        and(eq(conversations.workspaceId, wsId), gte(conversations.startedAt, monthStart)),
      );

    // Per-agent call counts (MTD) for voice agents
    const voiceIds = voiceAgents.map((v) => v.id);
    let perAgentCounts: Array<{ agentId: number; n: number }> = [];
    if (voiceIds.length > 0) {
      perAgentCounts = await tx
        .select({
          agentId: conversations.agentId,
          n: count(),
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.workspaceId, wsId),
            gte(conversations.startedAt, monthStart),
            sql`${conversations.agentId} IN (${sql.join(
              voiceIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          ),
        )
        .groupBy(conversations.agentId);
    }
    const callCountByAgent = new Map(perAgentCounts.map((r) => [r.agentId, Number(r.n)]));
    voiceAgents.forEach((v) => {
      v.callCount = callCountByAgent.get(v.id) ?? 0;
    });

    return {
      agentRows,
      voiceAgents,
      recent,
      stats: {
        convTotal: Number(convTotal?.value ?? 0),
        convMtd: Number(convMtd?.value ?? 0),
        leadsMtd: Number(leadsMtd?.value ?? 0),
        activeAgents: Number(activeAgents?.value ?? 0),
        totalAgents: Number(totalAgents?.value ?? 0),
        // Rough cost: $0.0005/1K input + $0.0015/1K output (gemini-1.5-flash ballpark).
        spendCents: Math.round(
          (Number(tokenSums?.inTok ?? 0) * 0.05 +
            Number(tokenSums?.outTok ?? 0) * 0.15) /
            1000,
        ),
      },
    };
  });

  const isEmpty = data.agentRows.length === 0;

  // TODO: replace with real time-bucketed series; for now hand-rolled dummy 12-pt arrays.
  const sparks = {
    conversations: makeSpark(12, data.stats.convTotal),
    leads: makeSpark(12, data.stats.leadsMtd),
    spend: makeSpark(12, data.stats.spendCents / 100),
    active: makeSpark(12, data.stats.activeAgents, true),
  };

  return (
    <>
      <AppTopbar title="Dashboard" />
      <main className="flex-1 overflow-y-auto bg-fill px-6 py-6">
        {props.searchParams.onboarding === '1' && (
          <div className="mb-6 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">
            Welcome to Vocera. Create your first AI agent to get started.
          </div>
        )}

        {/* 1. Quick actions */}
        <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction
            href="/agents/new"
            title="Create AI agent"
            subtitle="Purpose + docs"
            iconKey="bot"
            accent
          />
          <QuickAction
            href="/voice/new"
            title="New voice agent"
            subtitle="For Twilio / IVR"
            iconKey="phone"
          />
          <QuickAction
            href="/support/new"
            title="New support agent"
            subtitle="Embed in your app"
            iconKey="book"
          />
          <QuickAction
            href="/analysis"
            title="View analytics"
            subtitle="Leads & insights"
            iconKey="chart"
          />
        </section>

        {/* 2. Stats row */}
        <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Conversations"
            value={fmtNumber(data.stats.convTotal)}
            delta={`${data.stats.convMtd} MTD`}
            deltaUp
            spark={sparks.conversations}
          />
          <StatCard
            label="Leads captured"
            value={fmtNumber(data.stats.leadsMtd)}
            delta="MTD"
            deltaUp
            spark={sparks.leads}
          />
          <StatCard
            label="Spend MTD"
            value={fmtCurrency(data.stats.spendCents)}
            delta="est."
            deltaUp
            spark={sparks.spend}
          />
          <StatCard
            label="Active agents"
            value={`${data.stats.activeAgents}${data.stats.totalAgents > 0 ? ` / ${data.stats.totalAgents}` : ''}`}
            delta={data.stats.activeAgents === 0 ? 'none yet' : 'live'}
            deltaUp={data.stats.activeAgents > 0}
            spark={sparks.active}
          />
        </section>

        {isEmpty ? (
          <EmptyState />
        ) : (
          <>
            {/* 3. Two-column grid */}
            <section className="mb-4 grid gap-4 lg:grid-cols-2">
              <AIAgentsCard agents={data.agentRows} />
              <VoiceAgentsCard voiceAgents={data.voiceAgents} />
            </section>

            {/* 4. Recent conversations table */}
            <RecentConversationsTable rows={data.recent} />
          </>
        )}
      </main>
    </>
  );
}

// ─── Quick actions ────────────────────────────────────────────────────────────

function QuickAction({
  href,
  title,
  subtitle,
  iconKey,
  accent,
}: {
  href: string;
  title: string;
  subtitle: string;
  iconKey: 'bot' | 'phone' | 'book' | 'chart';
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-lg border px-4 py-3.5 transition ${
        accent
          ? 'border-accent/40 bg-accent-soft hover:bg-accent/15'
          : 'border-line-soft bg-paper hover:bg-fill'
      }`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-md ${
          accent ? 'bg-accent text-paper' : 'bg-fill text-ink-2'
        }`}
        aria-hidden
      >
        <Icon name={iconKey} />
      </span>
      <span className="flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-xs text-ink-3">{subtitle}</span>
      </span>
      <span aria-hidden className="text-ink-3 transition group-hover:translate-x-0.5">
        →
      </span>
    </Link>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  delta,
  deltaUp = true,
  spark,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaUp?: boolean;
  spark: number[];
}) {
  return (
    <div className="rounded-lg border border-line-soft bg-paper px-4 py-4">
      <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
        <span>{label}</span>
      </div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight text-ink">{value}</span>
        {delta && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              deltaUp
                ? 'bg-ok/15 text-ok'
                : 'bg-err/15 text-err'
            }`}
          >
            {deltaUp ? '↑' : '↓'} {delta}
          </span>
        )}
      </div>
      <Sparkline data={spark} />
    </div>
  );
}

// ─── Sparkline (hand-rolled SVG, no library) ──────────────────────────────────

function Sparkline({ data, width = 220, height = 32 }: { data: number[]; width?: number; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const line = pts
    .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block h-8 w-full"
      aria-hidden
    >
      <path d={area} fill="var(--accent)" fillOpacity={0.12} />
      <path d={line} stroke="var(--accent)" strokeWidth={1.5} fill="none" />
    </svg>
  );
}

// ─── AI agents list card ──────────────────────────────────────────────────────

function AIAgentsCard({ agents: rows }: { agents: AgentRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line-soft bg-paper">
      <div className="flex items-center justify-between border-b border-line-softer px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name="bot" />
          <span className="text-sm font-semibold">AI Agents</span>
          <span className="rounded-full border border-line-soft px-1.5 py-0.5 text-[10px] text-ink-3">
            {rows.length}
          </span>
        </div>
        <Link href="/agents" className="text-xs text-ink-3 hover:text-accent">
          View all →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">No agents yet.</p>
      ) : (
        <ul>
          {rows.slice(0, 5).map((a, i, arr) => (
            <li
              key={a.id}
              className={`flex items-center gap-3 px-4 py-3 ${
                i < arr.length - 1 ? 'border-b border-line-softer' : ''
              }`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Icon name="bot" size={14} />
              </span>
              <Link
                href={`/agents/${a.externalId}`}
                className="flex-1 min-w-0 hover:text-accent"
              >
                <div className="truncate text-sm font-medium text-ink">{a.name}</div>
                <div className="truncate text-xs text-ink-3">
                  {a.purpose} · v{a.currentVersion} · {a.docCount} docs
                </div>
              </Link>
              <StatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line-softer px-4 py-3 text-center">
        <Link
          href="/agents/new"
          className="inline-block rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-paper"
        >
          + Create AI agent
        </Link>
      </div>
    </div>
  );
}

// ─── Voice agents list card ───────────────────────────────────────────────────

function VoiceAgentsCard({ voiceAgents }: { voiceAgents: VoiceAgentRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line-soft bg-paper">
      <div className="flex items-center justify-between border-b border-line-softer px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name="phone" />
          <span className="text-sm font-semibold">Voice Agents</span>
          <span className="rounded-full border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
            {voiceAgents.length}
          </span>
        </div>
        <Link href="/voice" className="text-xs text-ink-3 hover:text-accent">
          View all →
        </Link>
      </div>
      {voiceAgents.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">No voice agents yet.</p>
      ) : (
        <ul>
          {voiceAgents.slice(0, 5).map((v, i, arr) => (
            <li
              key={v.id}
              className={`flex items-center gap-3 px-4 py-3 ${
                i < arr.length - 1 ? 'border-b border-line-softer' : ''
              }`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Icon name="phone" size={14} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium text-ink">{v.name}</div>
                <div className="truncate text-xs text-ink-3">
                  <span className="font-mono">{v.phoneNumber ?? '— not deployed'}</span> ·{' '}
                  {v.mode}
                </div>
              </div>
              <span className="font-mono text-xs text-ink-3">{v.callCount}</span>
              <StatusBadge status={v.status} />
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line-softer px-4 py-3 text-center">
        <Link
          href="/voice/new"
          className="inline-block rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-paper"
        >
          + Create voice agent
        </Link>
      </div>
    </div>
  );
}

// ─── Recent conversations table ───────────────────────────────────────────────

function RecentConversationsTable({ rows }: { rows: ConversationRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line-soft bg-paper">
      <div className="flex items-center justify-between border-b border-line-softer px-4 py-3">
        <span className="text-sm font-semibold">Recent conversations</span>
        <Link href="/logs" className="text-xs text-ink-3 hover:text-accent">
          View all →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">No conversations yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-softer text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-4 py-2 font-medium">Caller</th>
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">Intent</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i, arr) => (
                <tr
                  key={c.id}
                  className={i < arr.length - 1 ? 'border-b border-line-softer' : ''}
                >
                  <td className="px-4 py-2.5 text-ink">
                    {c.callerName ?? c.callerId ?? 'Anonymous'}
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{c.agentName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-ink-3">{c.intent ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-3">
                    {fmtDuration(c.durationMs)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-3">
                    {new Date(c.startedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.text}`}
    >
      {status}
    </span>
  );
}

function statusTone(status: string): { bg: string; text: string } {
  switch (status) {
    case 'live':
    case 'completed':
      return { bg: 'bg-ok/15', text: 'text-ok' };
    case 'in-progress':
      return { bg: 'bg-accent-soft', text: 'text-accent' };
    case 'escalated':
    case 'missed':
      return { bg: 'bg-warn/15', text: 'text-warn' };
    case 'failed':
      return { bg: 'bg-err/15', text: 'text-err' };
    case 'draft':
    default:
      return { bg: 'bg-fill', text: 'text-ink-3' };
  }
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-line-soft bg-paper px-8 py-16 text-center">
      <h2 className="text-lg font-semibold">Create your first AI agent</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
        Pick a purpose, drop in your knowledge base, and your agent is ready to talk in
        minutes.
      </p>
      <Link
        href="/agents/new"
        className="mt-6 inline-block rounded-md bg-accent px-5 py-2.5 font-medium text-paper"
      >
        Start the wizard
      </Link>
    </div>
  );
}

// ─── Inline icons (no lucide-react dependency) ────────────────────────────────

function Icon({
  name,
  size = 16,
}: {
  name: 'bot' | 'phone' | 'book' | 'chart';
  size?: number;
}) {
  const paths: Record<typeof name, string> = {
    bot: 'M12 2v3M5 9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM9 13h.01M15 13h.01',
    phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
    book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5V21h16',
    chart: 'M3 3v18h18M7 14l4-4 4 4 5-7',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNumber(n: number): string {
  return n.toLocaleString();
}

function fmtCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

// TODO: replace with real time-bucketed series. Generates a 12-point ramp toward `target`.
function makeSpark(n: number, target: number, flat = false): number[] {
  const t = Math.max(target, 1);
  if (flat) return Array.from({ length: n }, () => t);
  return Array.from({ length: n }, (_, i) => {
    const ratio = (i + 1) / n;
    // gentle ease-in curve so the line trends up toward `target`
    const v = t * (0.4 + 0.6 * ratio);
    // tiny deterministic wobble (no Math.random — server-safe)
    const wobble = Math.sin(i * 1.3) * (t * 0.04);
    return Math.max(0, v + wobble);
  });
}
