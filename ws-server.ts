/**
 * Standalone WebSocket server for the Vocera voice loop.
 *
 * Why a separate process: when WS upgrades share an HTTP server with Next.js,
 * Next attaches its own 'upgrade' listener (for HMR + RSC streaming) that
 * races with ours. Even with pathname filtering, the parser inside `ws` can
 * collide with Node 25's built-in `WebSocket`/undici globals — producing
 * "Invalid frame header" errors that we chased through a long debug loop.
 *
 * This file binds *only* the WS server to a separate port (3001 by default).
 * Token validation hits the same Postgres DB that the Next.js Route Handler
 * (/api/v1/agents/:id/voice-session) writes to, so auth stays consistent.
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { parse } from 'node:url';
import { WebSocketServer } from 'ws';
import { handleVoiceConnection } from './src/server/ws/voice';
import { takeSession } from './src/server/ws/sessions';
import { handleTwilioConnection } from './src/server/twilio/twilio-stream';
import { loadDeploymentByToken, type LoadedDeployment } from './src/server/twilio/loader';

const port = Number(process.env.WS_PORT ?? 3001);
const hostname = process.env.WS_HOSTNAME ?? '0.0.0.0';

const httpServer = createServer((req, res) => {
  // Trivial health-check; everything else is WS.
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', async (req, socket, head) => {
  const { pathname } = parse(req.url ?? '/', true);
  console.log('[ws-server] upgrade', pathname);

  if (!pathname?.startsWith('/voice/') && !pathname?.startsWith('/twilio/')) {
    socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }

  // Long-lived voice/media WS — disable Node's idle timeout, enable TCP keep-alive.
  // The upgrade socket type is widened to Duplex; cast to net.Socket for TCP knobs.
  const tcp = socket as Socket;
  tcp.setTimeout(0);
  tcp.setKeepAlive(true, 30_000);
  tcp.setNoDelay(true);

  if (pathname.startsWith('/voice/')) {
    const token = pathname.slice('/voice/'.length);
    if (!token) {
      socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }

    // Pre-validate the session BEFORE upgrading so the handshake response and
    // first JSON frames fly back-to-back with zero idle gap. Single-use token.
    let session: Awaited<ReturnType<typeof takeSession>> = null;
    try {
      session = await takeSession(token);
    } catch (err) {
      console.error('[ws-server] takeSession threw', err);
      try {
        socket.write('HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n');
      } catch {}
      socket.destroy();
      return;
    }
    if (!session) {
      console.warn('[ws-server] invalid/expired session', token);
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }

    console.log('[ws-server] upgrading (session pre-validated)');
    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log('[ws-server] upgrade complete');
      handleVoiceConnection(ws, session!).catch((err) => {
        console.error('[ws-server] handler crashed', err);
        try {
          ws.close(1011, 'internal error');
        } catch {}
      });
    });
    return;
  }

  // /twilio/<wsk> — Twilio Media Streams. Token is reusable (non-destructive load).
  const token = pathname.slice('/twilio/'.length);
  if (!token) {
    socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }

  let loaded: LoadedDeployment | null = null;
  try {
    loaded = await loadDeploymentByToken(token);
  } catch (err) {
    console.error('[ws-server] loadDeploymentByToken threw', err);
    try {
      socket.write('HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n');
    } catch {}
    socket.destroy();
    return;
  }
  if (!loaded) {
    console.warn('[ws-server] invalid twilio token', token);
    socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }
  if (!loaded.telephony) {
    console.warn('[ws-server] twilio deployment missing telephony creds', token);
    socket.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }

  console.log('[ws-server] upgrading twilio stream (deployment pre-validated)');
  wss.handleUpgrade(req, socket, head, (ws) => {
    console.log('[ws-server] twilio upgrade complete');
    handleTwilioConnection(ws, loaded!).catch((err) => {
      console.error('[ws-server] twilio handler crashed', err);
      try {
        ws.close(1011, 'internal error');
      } catch {}
    });
  });
});

httpServer.listen(port, hostname, () => {
  console.log(
    `▲ Vocera WS server ready on\n` +
      `    ws://${hostname}:${port}/voice/<sess-token>     (browser)\n` +
      `    ws://${hostname}:${port}/twilio/<wsk-token>     (Twilio Media Streams)`,
  );
});

// Graceful shutdown on SIGINT — terminates outstanding connections cleanly.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[ws-server] received ${sig}, closing`);
    wss.close();
    httpServer.close(() => process.exit(0));
  });
}
