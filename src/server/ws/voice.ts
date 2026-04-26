/**
 * /ws/voice/:sessionId
 *
 * Browser → server: binary frames of 16-bit PCM @ 16kHz, plus a JSON 'bye'.
 * Server → browser: binary audio chunks (PCM 16kHz) + JSON events
 *   { type: 'partial' | 'final' | 'agent_text' | 'clear' | 'metrics' | 'error' }
 *
 * Single Node process owns STT + LLM + TTS for the session — no IPC overhead.
 */
import type { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { withWorkspace } from '@/db/client';
import { conversations, messages } from '@/db/schema';
import { DeepgramStream } from '@/server/ai/stt';
import { VoicePipeline } from '@/server/ai/pipeline';
import { newId } from '@/server/ids';
import { deepgramLanguage } from '@/lib/languages';
import { takeSession } from './sessions';

export async function handleVoiceConnection(ws: WebSocket, sessionId: string) {
  const session = await takeSession(sessionId);
  if (!session) {
    ws.send(JSON.stringify({ type: 'error', error: 'invalid or expired session' }));
    ws.close(1008, 'invalid session');
    return;
  }

  const { agent } = session;
  const sendJson = (obj: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  const sendBinary = (buf: Buffer) => {
    if (ws.readyState === ws.OPEN) ws.send(buf, { binary: true });
  };

  // Persist conversation row up-front so messages have a parent FK.
  const conversationId = await createConversation({
    workspaceId: 0, // placeholder — using session's workspace
    workspaceExternalId: agent.workspaceExternalId,
    agentId: agent.agentId,
  });

  // Per-turn buffer for the agent's emitted text (so we can persist on turn end).
  let agentTextBuf = '';

  const pipeline = new VoicePipeline(agent, {
    onAudio: sendBinary,
    onUserPartial: (text) => sendJson({ type: 'partial', text }),
    onUserFinal: async (text, language) => {
      sendJson({ type: 'final', text, language });
      // Persist user turn.
      await persistMessage({
        workspaceExternalId: agent.workspaceExternalId,
        conversationId,
        role: 'user',
        content: text,
        language,
        ttftMs: null,
      });
    },
    onAgentText: (delta) => {
      agentTextBuf += delta;
      sendJson({ type: 'agent_text', delta });
    },
    onClear: () => sendJson({ type: 'clear' }),
    onMetrics: async ({ ttftMs }) => {
      sendJson({ type: 'metrics', ttftMs });
      // Persist whatever the agent has said for the turn — best effort.
      const text = agentTextBuf;
      agentTextBuf = '';
      if (text.trim()) {
        await persistMessage({
          workspaceExternalId: agent.workspaceExternalId,
          conversationId,
          role: 'agent',
          content: text,
          language: agent.defaultLanguage,
          ttftMs,
        });
      }
    },
  });

  // Open STT.
  const stt = new DeepgramStream({
    language: deepgramLanguage(agent.languages),
    detectLanguage: agent.languages.length > 1,
    sampleRate: 16000,
  });
  try {
    await stt.open();
  } catch (err) {
    sendJson({ type: 'error', error: 'stt-open-failed' });
    console.error('[ws/voice] STT open failed', err);
    ws.close(1011, 'stt failed');
    return;
  }

  stt.on('event', async (e) => {
    if (e.type === 'speech_started') {
      pipeline.onSpeechStarted();
    } else if (e.type === 'final') {
      // Fire-and-forget — pipeline owns its own concurrency control.
      pipeline.onUserUtterance(e.text, e.language).catch((err) => {
        console.error('[ws/voice] pipeline error', err);
      });
    } else if (e.type === 'partial') {
      sendJson({ type: 'partial', text: e.text });
    } else if (e.type === 'error') {
      sendJson({ type: 'error', error: e.error });
    }
  });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      stt.send(raw as Buffer);
    } else {
      // Control messages: { type: 'bye' } | { type: 'mute' } etc.
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        if (msg.type === 'bye') ws.close(1000, 'bye');
      } catch {
        /* ignore */
      }
    }
  });

  ws.on('close', async () => {
    await stt.close().catch(() => {});
    await closeConversation({
      workspaceExternalId: agent.workspaceExternalId,
      conversationId,
    });
  });
}

// ─── DB helpers ─────────────────────────────────────────────
async function createConversation(opts: {
  workspaceId: number;
  workspaceExternalId: string;
  agentId: number;
}): Promise<number> {
  // Need workspace_id (numeric) — look it up from external id once per call.
  const wsId = await resolveWorkspaceId(opts.workspaceExternalId);
  return withWorkspace(wsId, async (tx) => {
    const [row] = await tx
      .insert(conversations)
      .values({
        externalId: newId('ca'),
        workspaceId: wsId,
        agentId: opts.agentId,
        channel: 'custom',
        direction: 'inbound',
        status: 'in-progress',
      })
      .returning({ id: conversations.id });
    return row.id;
  });
}

async function persistMessage(opts: {
  workspaceExternalId: string;
  conversationId: number;
  role: 'user' | 'agent' | 'tool' | 'system';
  content: string;
  language?: string;
  ttftMs: number | null;
}) {
  const wsId = await resolveWorkspaceId(opts.workspaceExternalId);
  await withWorkspace(wsId, async (tx) => {
    // Determine next turn index — small race is fine for an MVP test surface.
    const existing = await tx
      .select({ ti: messages.turnIndex })
      .from(messages)
      .where(eq(messages.conversationId, opts.conversationId));
    const nextTurn = (existing.reduce((m, r) => Math.max(m, r.ti), -1) ?? -1) + 1;
    await tx.insert(messages).values({
      workspaceId: wsId,
      conversationId: opts.conversationId,
      turnIndex: nextTurn,
      role: opts.role,
      content: opts.content,
      language: opts.language ?? null,
      ttftMs: opts.ttftMs ?? null,
    });
  });
}

async function closeConversation(opts: { workspaceExternalId: string; conversationId: number }) {
  const wsId = await resolveWorkspaceId(opts.workspaceExternalId);
  await withWorkspace(wsId, async (tx) => {
    await tx
      .update(conversations)
      .set({ status: 'completed', endedAt: new Date() })
      .where(eq(conversations.id, opts.conversationId));
  });
}

// Avoid resolving once-per-call repeatedly: in-memory cache keyed by external id.
const wsIdCache = new Map<string, number>();
async function resolveWorkspaceId(externalId: string): Promise<number> {
  const hit = wsIdCache.get(externalId);
  if (hit) return hit;
  const { db } = await import('@/db/client');
  const { workspaces } = await import('@/db/schema');
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.externalId, externalId))
    .limit(1);
  if (!row) throw new Error(`workspace not found: ${externalId}`);
  wsIdCache.set(externalId, row.id);
  return row.id;
}
