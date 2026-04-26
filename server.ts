/**
 * Next.js HTTP server.
 *
 * The voice WebSocket runs in a separate process (ws-server.ts) on its own
 * port. Two-process design eliminates the Next.js + ws-library + Node 25
 * upgrade-handler race that produced "Invalid frame header" errors when both
 * shared a single HTTP server.
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? 'localhost';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  const parsed = parse(req.url ?? '/', true);
  handle(req, res, parsed);
});

httpServer.listen(port, () => {
  console.log(`▲ Vocera (Next.js) ready on http://${hostname}:${port}`);
});
