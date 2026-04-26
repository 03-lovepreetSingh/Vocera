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

  if (!pathname?.startsWith('/voice/')) {
    socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }

  const token = pathname.slice('/voice/'.length);
  if (!token) {
    socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }

  // Long-lived voice WS — disable Node's idle timeout, enable TCP keep-alive.
  // The upgrade socket type is widened to Duplex; cast to net.Socket for the
  // TCP-specific knobs.
  const tcp = socket as Socket;
  tcp.setTimeout(0);
  tcp.setKeepAlive(true, 30_000);
  tcp.setNoDelay(true);

  // Pre-validate the session BEFORE upgrading so the handshake response and
  // first JSON frames fly back-to-back with zero idle gap.
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
});

httpServer.listen(port, hostname, () => {
  console.log(`▲ Vocera WS server ready on ws://${hostname}:${port}/voice/<token>`);
});

// Graceful shutdown on SIGINT — terminates outstanding connections cleanly.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[ws-server] received ${sig}, closing`);
    wss.close();
    httpServer.close(() => process.exit(0));
  });
}
