/**
 * Twilio Media Streams ↔ VoicePipeline adapter.
 * Twilio frames: JSON-wrapped 8 kHz μ-law @ 20 ms (160 B). Pipeline produces
 * ElevenLabs MP3 and consumes 8 kHz μ-law for STT. Per-connection ffmpeg bridge:
 *   pipeline.onAudio(MP3) → ffmpeg.stdin
 *   ffmpeg.stdout(μ-law)  → 160-B framing → ws.send({event:'media',...})
 *   ws.recv({event:'media'}) → base64 decode → stt.send(μ-law buf)
 * No echo gating: PSTN carriers handle echo cancel; gating clips barge-in.
 */
import type { WebSocket } from 'ws';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { DeepgramStream } from '@/server/ai/stt';
import { VoicePipeline, type AgentContext } from '@/server/ai/pipeline';
import { deepgramLanguage } from '@/lib/languages';
import { createConversation, persistMessage, closeConversation } from '@/server/conversations/persist';
import type { LoadedDeployment } from '@/server/twilio/loader';

const FRAME_BYTES = 160; // 20 ms μ-law @ 8 kHz

interface StartFrame {
  event: 'start';
  start: { streamSid: string; callSid: string; customParameters?: Record<string, string> };
}

export async function handleTwilioConnection(ws: WebSocket, loaded: LoadedDeployment): Promise<void> {
  if (!ffmpegPath) {
    console.error('[twilio.stream] ffmpeg-static path missing — cannot transcode');
    try { ws.close(1011, 'ffmpeg unavailable'); } catch {}
    return;
  }
  const ffmpegBin: string = ffmpegPath;

  // Wait for the first `start` frame before allocating the pipeline / DB row.
  // `connected` is informational; pre-start media (rare) is skipped.
  const start = await waitForStart(ws);
  if (!start) return; // socket already closed/errored

  const { streamSid, callSid } = start.start;
  const direction =
    (start.start.customParameters?.direction as 'inbound' | 'outbound' | undefined) ?? 'inbound';

  console.log('[twilio.stream] start streamSid=', streamSid, 'callSid=', callSid, 'direction=', direction);

  // Conversation row up-front so message persistence has a parent FK.
  let conversationId: number;
  try {
    conversationId = await createConversation({
      workspaceExternalId: loaded.agent.workspaceExternalId,
      agentId: loaded.agent.agentId,
      channel: 'voice',
      direction,
      externalCallSid: callSid,
    });
  } catch (err) {
    console.error('[twilio.stream] createConversation failed', err);
    try { ws.close(1011, 'db error'); } catch {}
    return;
  }

  let closed = false;
  const sendJson = (obj: unknown) => {
    if (closed || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch (err) {
      console.error('[twilio.stream] sendJson failed', err);
    }
  };

  // ffmpeg child (MP3 → μ-law 8 kHz mono). One per connection.
  let ff: ChildProcessWithoutNullStreams = spawnFfmpeg(ffmpegBin);
  let muTail = Buffer.alloc(0); // accumulator for 160-byte framing
  attachFfmpegHandlers();

  function attachFfmpegHandlers() {
    muTail = Buffer.alloc(0);
    ff.stderr.on('data', (chunk) => {
      const line = chunk.toString().trim();
      if (line) console.warn('[twilio.stream] ffmpeg stderr:', line);
    });
    ff.stdout.on('data', (chunk: Buffer) => {
      muTail = Buffer.concat([muTail, chunk]);
      while (muTail.length >= FRAME_BYTES) {
        const frame = muTail.subarray(0, FRAME_BYTES);
        muTail = muTail.subarray(FRAME_BYTES);
        sendJson({ event: 'media', streamSid, media: { payload: frame.toString('base64') } });
      }
    });
    ff.on('exit', (code, signal) => {
      if (closed) return;
      console.error('[twilio.stream] ffmpeg unexpected exit code=', code, 'signal=', signal);
      shutdown(1011, 'ffmpeg exit');
    });
  }

  // onClear: residual MP3 buffered inside ffmpeg would otherwise produce stale
  // audio after barge-in. Kill+respawn (~50 ms) is the simplest correct drain.
  function restartFfmpeg() {
    try { ff.removeAllListeners('exit'); } catch {}
    try { ff.kill('SIGTERM'); } catch {}
    ff = spawnFfmpeg(ffmpegBin);
    attachFfmpegHandlers();
  }

  // Pipeline + STT
  const agentForCall: AgentContext = { ...loaded.agent, ttsFormat: 'mp3_22050_32' };
  let agentTextBuf = '';

  const pipeline = new VoicePipeline(agentForCall, {
    onAudio: (mp3Buf) => {
      if (closed) return;
      try { ff.stdin.write(mp3Buf); } catch (err) {
        console.warn('[twilio.stream] ffmpeg stdin write failed', err);
      }
    },
    onAgentText: (delta) => { agentTextBuf += delta; },
    onUserPartial: () => { /* Twilio has no transcript UI — drop. */ },
    onUserFinal: async (text, language) => {
      try {
        await persistMessage({
          workspaceExternalId: loaded.agent.workspaceExternalId,
          conversationId, role: 'user', content: text, language, ttftMs: null,
        });
      } catch (err) { console.error('[twilio.stream] persist user failed', err); }
    },
    onClear: () => {
      sendJson({ event: 'clear', streamSid });
      restartFfmpeg();
    },
    onAudioDone: () => sendJson({ event: 'mark', streamSid, mark: { name: 'agent-spoke' } }),
    onSpeakText: () => { /* No browser SpeechSynthesis on the telco path. */ },
    onMetrics: async ({ ttftMs }) => {
      const text = agentTextBuf;
      agentTextBuf = '';
      if (!text.trim()) return;
      try {
        await persistMessage({
          workspaceExternalId: loaded.agent.workspaceExternalId,
          conversationId, role: 'agent', content: text,
          language: loaded.agent.defaultLanguage, ttftMs,
        });
      } catch (err) { console.error('[twilio.stream] persist agent failed', err); }
    },
  });

  const stt = new DeepgramStream({
    language: deepgramLanguage(loaded.agent.languages),
    detectLanguage: loaded.agent.languages.length > 1,
    sampleRate: 8000,
    encoding: 'mulaw',
    endpointingMs: 300,
    utteranceEndMs: 800,
  });
  try {
    await stt.open();
  } catch (err) {
    console.error('[twilio.stream] STT open failed', err);
    await shutdown(1011, 'stt failed');
    return;
  }

  stt.on('event', (e) => {
    if (e.type === 'speech_started') pipeline.onSpeechStarted();
    else if (e.type === 'final') {
      pipeline.onUserUtterance(e.text, e.language).catch((err) =>
        console.error('[twilio.stream] pipeline error', err),
      );
    } else if (e.type === 'error') console.error('[twilio.stream] STT error', e.error);
  });

  // Greet now — same pattern as the browser path. For outbound we may inject
  // a deployment-configured opener; otherwise the agent's default-language
  // greeting is fine on both directions.
  await pipeline.greet().catch((err) => console.warn('[twilio.stream] greet failed', err));
  if (direction === 'outbound') {
    const opener = (loaded.deployment as { config?: { outboundOpener?: string } }).config?.outboundOpener;
    if (opener) pipeline.seedAssistantTurn(opener);
  }

  // Inbound media + lifecycle
  ws.on('message', (raw) => {
    let msg: { event?: string; media?: { payload?: string }; stop?: unknown };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.event === 'media' && msg.media?.payload) {
      // Pass every frame through — telco echo cancel handles overlap.
      try { stt.send(Buffer.from(msg.media.payload, 'base64')); } catch (err) {
        console.warn('[twilio.stream] stt.send failed', err);
      }
    } else if (msg.event === 'stop') {
      console.log('[twilio.stream] stop streamSid=', streamSid);
      shutdown(1000, 'stop');
    }
  });

  ws.on('error', (err) => {
    console.error('[twilio.stream] ws error', err);
    shutdown(1011, 'ws error');
  });
  ws.once('close', (code) => {
    console.log('[twilio.stream] ws close code=', code, 'streamSid=', streamSid);
    shutdown(code ?? 1000, 'ws close');
  });

  async function shutdown(code: number, reason: string) {
    if (closed) return;
    closed = true;
    console.log('[twilio.stream] shutdown reason=', reason, 'conversationId=', conversationId);
    try { pipeline.teardown(); } catch {}
    await stt.close().catch(() => {});
    try { ff.removeAllListeners('exit'); ff.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { ff.kill('SIGKILL'); } catch {} }, 1000).unref();
    try { if (ws.readyState === 1) ws.close(code, reason); } catch {}
    await closeConversation({
      workspaceExternalId: loaded.agent.workspaceExternalId,
      conversationId,
    }).catch((err) => console.warn('[twilio.stream] closeConversation failed', err));
  }
}

function spawnFfmpeg(bin: string): ChildProcessWithoutNullStreams {
  return spawn(
    bin,
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'mulaw', '-ar', '8000', '-ac', '1', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

function waitForStart(ws: WebSocket): Promise<StartFrame | null> {
  return new Promise((resolve) => {
    const onMsg = (raw: unknown) => {
      let msg: { event?: string };
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.event === 'connected') return; // first frame, ignore
      if (msg.event === 'start') {
        ws.off('message', onMsg);
        ws.off('close', onClose);
        ws.off('error', onErr);
        resolve(msg as unknown as StartFrame);
      }
      // pre-start media frames: skip silently (Twilio doesn't actually send any).
    };
    const onClose = () => { ws.off('message', onMsg); resolve(null); };
    const onErr = () => { ws.off('message', onMsg); resolve(null); };
    ws.on('message', onMsg);
    ws.once('close', onClose);
    ws.once('error', onErr);
  });
}
