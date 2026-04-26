/**
 * Custom Next.js server that mounts a long-lived WebSocket route at /ws/voice/:sessionId
 * alongside the standard Next.js HTTP handler. Non-voice upgrade requests
 * (notably /_next/webpack-hmr) are passed through to Next so HMR works.
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { handleVoiceConnection } from './src/server/ws/voice';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? 'localhost';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const upgradeHandler = (app as unknown as { getUpgradeHandler?: () => (req: any, socket: any, head: any) => void }).getUpgradeHandler?.();

await app.prepare();

const httpServer = createServer((req, res) => {
  const parsed = parse(req.url ?? '/', true);
  handle(req, res, parsed);
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = parse(req.url ?? '/', true);

  if (pathname?.startsWith('/ws/voice/')) {
    const sessionId = pathname.slice('/ws/voice/'.length);
    if (!sessionId) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleVoiceConnection(ws, sessionId).catch((err) => {
        console.error('[ws/voice] handler crashed', err);
        ws.close(1011, 'internal error');
      });
    });
    return;
  }

  // Everything else (notably /_next/webpack-hmr) goes to Next's own upgrade handler.
  if (upgradeHandler) {
    upgradeHandler(req, socket, head);
  } else {
    socket.destroy();
  }
});

httpServer.listen(port, () => {
  console.log(`▲ Vocera ready on http://${hostname}:${port}`);
});
