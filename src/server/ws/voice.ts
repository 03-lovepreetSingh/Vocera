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
import { deepgramLanguage, detectLanguageFromText, greetingFor } from '@/lib/languages';
import type { takeSession } from './sessions';

type ResolvedSession = NonNullable<Awaited<ReturnType<typeof takeSession>>>;

export async function handleVoiceConnection(ws: WebSocket, session: ResolvedSession) {
  console.log('[ws/voice] handleVoiceConnection start, agent=', session.agent.agentExternalId);

  // Send ready immediately — session was pre-validated before upgrade, so
  // there's no DB await between handshake and our first frame.
  try {
    ws.send(JSON.stringify({ type: 'ready' }));
  } catch (err) {
    console.error('[ws/voice] ready send failed', err);
  }

  const { agent } = session;
  const sendJson = (obj: unknown) => {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch (err) {
      console.error('[ws/voice] sendJson failed', err);
    }
  };
  const sendBinary = (buf: Buffer) => {
    if (ws.readyState !== 1) return;
    try {
      ws.send(buf, { binary: true });
    } catch (err) {
      console.error('[ws/voice] sendBinary failed', err);
    }
  };

  ws.on('error', (err) => console.error('[ws/voice] ws error', err));

  // Greet immediately — fires in the same tick as `ready`, so the browser
  // hears the greeting before any DB or STT init can stall the connection.
  const greetText = greetingFor(agent.defaultLanguage);
  // Use the detected script of the actual greeting text, not just the agent's
  // configured default language code, so non-Latin scripts get the right voice.
  const greetLang = detectLanguageFromText(greetText, agent.defaultLanguage);
  try {
    ws.send(JSON.stringify({ type: 'agent_text', delta: greetText }));
    ws.send(JSON.stringify({ type: 'speak_text', text: greetText, lang: greetLang }));
  } catch (err) {
    console.error('[ws/voice] greet inline send failed', err);
  }

  // Persist conversation row up-front so messages have a parent FK.
  let conversationId: number;
  try {
    console.log('[ws/voice] creating conversation row...');
    conversationId = await createConversation({
      workspaceId: 0,
      workspaceExternalId: agent.workspaceExternalId,
      agentId: agent.agentId,
    });
    console.log('[ws/voice] conversation row created, id=', conversationId);
  } catch (err) {
    console.error('[ws/voice] createConversation failed', err);
    sendJson({ type: 'error', error: 'db error creating conversation' });
    ws.close(1011, 'db error');
    return;
  }

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
    onAudioDone: () => sendJson({ type: 'audio_done' }),
    onSpeakText: (text, lang) => sendJson({ type: 'speak_text', text, lang }),
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
  const dgLang = deepgramLanguage(agent.languages);
  console.log('[ws/voice] opening Deepgram STT, language=', dgLang, 'detect=', agent.languages.length > 1);
  const stt = new DeepgramStream({
    language: dgLang,
    detectLanguage: agent.languages.length > 1,
    sampleRate: 16000,
  });
  try {
    await stt.open();
    console.log('[ws/voice] Deepgram STT open');
  } catch (err) {
    sendJson({ type: 'error', error: 'stt-open-failed' });
    console.error('[ws/voice] STT open failed', err);
    ws.close(1011, 'stt failed');
    return;
  }
  // Record the inline greeting in the pipeline's conversation history so the
  // LLM remembers it greeted on the next turn — without this it loops back
  // into greeting-style replies.
  pipeline.seedAssistantTurn(greetText);

  stt.on('event', async (e) => {
    if (e.type === 'speech_started') {
      console.log('[ws/voice] STT speech_started');
      pipeline.onSpeechStarted();
    } else if (e.type === 'final') {
      console.log('[ws/voice] STT final:', JSON.stringify(e.text), 'lang=', e.language);
      pipeline.onUserUtterance(e.text, e.language).catch((err) => {
        console.error('[ws/voice] pipeline error', err);
      });
    } else if (e.type === 'partial') {
      sendJson({ type: 'partial', text: e.text });
    } else if (e.type === 'utterance_end') {
      console.log('[ws/voice] STT utterance_end');
    } else if (e.type === 'error') {
      console.error('[ws/voice] STT error', e.error);
      sendJson({ type: 'error', error: e.error });
    }
  });

  let inboundBinaryFrames = 0;
  let inboundBinaryBytes = 0;
  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      inboundBinaryFrames++;
      inboundBinaryBytes += (raw as Buffer).length;
      if (inboundBinaryFrames === 1) {
        console.log('[ws/voice] first inbound audio frame, bytes=', (raw as Buffer).length);
      } else if (inboundBinaryFrames % 100 === 0) {
        console.log('[ws/voice] inbound audio: frames=', inboundBinaryFrames, 'bytes=', inboundBinaryBytes);
      }
      // Defense-in-depth: even if the browser gating fails (race, stale
      // ttsPlaying flag), don't forward mic frames to Deepgram while the
      // agent is mid-utterance — they're almost certainly speaker echo.
      if (pipeline.isSpeaking()) return;
      stt.send(raw as Buffer);
    } else {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        console.log('[ws/voice] control message', msg.type);
        if (msg.type === 'bye') ws.close(1000, 'bye');
      } catch {
        /* ignore */
      }
    }
  });

  ws.once('close', async (code, reason) => {
    console.log('[ws/voice] client closed', code, reason?.toString());
    // Cancel any in-flight LLM stream / TTS WS so dropping the browser mid-turn
    // doesn't leak upstream sockets.
    try {
      pipeline.teardown();
    } catch {}
    await stt.close().catch(() => {});
    await closeConversation({
      workspaceExternalId: agent.workspaceExternalId,
      conversationId,
    }).catch(() => {});
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
