// End-to-end voice session probe.
//
// Skips Next.js auth by minting a voice_sessions row directly in Postgres
// (same shape as `issueSession()` in src/server/ws/sessions.ts), then opens
// the WS at ws://localhost:3001/voice/<token>, logs every inbound frame
// (JSON + binary) with timestamps, streams 3s of fake silence PCM (320
// int16 samples = 640 bytes every 20ms), then closes after 6s total.
//
// Run: node scripts/voice-session-probe.mjs

import 'dotenv/config';
import pg from 'pg';
import WebSocket from 'ws';
import { customAlphabet } from 'nanoid';

const AGENT_EXTERNAL_ID = process.env.PROBE_AGENT_ID ?? 'ag_eBfV24rr7x';
const WS_URL_BASE = process.env.PROBE_WS_URL ?? 'ws://localhost:3001/voice/';

const t0 = Date.now();
const ts = () => `[+${(Date.now() - t0).toString().padStart(5, ' ')}ms]`;

function log(...args) {
  console.log(ts(), ...args);
}

async function mintTokenDirect() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error('DATABASE_URL not set in .env');
  const client = new pg.Client({ connectionString: conn });
  await client.connect();
  try {
    const r = await client.query(
      `SELECT id, workspace_id FROM agents WHERE external_id = $1 LIMIT 1`,
      [AGENT_EXTERNAL_ID],
    );
    if (r.rowCount === 0) {
      // fall back to any agent
      log('agent not found by external_id, falling back to first agent in DB');
      const any = await client.query(
        `SELECT id, workspace_id, external_id FROM agents ORDER BY id LIMIT 1`,
      );
      if (any.rowCount === 0) throw new Error('No agents exist in DB');
      log('using fallback agent', any.rows[0]);
      r.rows = any.rows;
      r.rowCount = 1;
    }
    const { id: agentId, workspace_id: workspaceId } = r.rows[0];
    const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 21);
    const token = `sess_${nano()}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await client.query(
      `INSERT INTO voice_sessions (token, workspace_id, agent_id, expires_at) VALUES ($1, $2, $3, $4)`,
      [token, workspaceId, agentId, expiresAt],
    );
    log('minted token directly via DB for agent_id=', agentId, 'ws_id=', workspaceId);
    return token;
  } finally {
    await client.end();
  }
}

function describeFrame(data, isBinary) {
  if (isBinary) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return `[binary ${buf.length} bytes] head=${buf.subarray(0, 8).toString('hex')}`;
  }
  const s = data.toString('utf8');
  if (s.length > 400) return `[json ${s.length}B] ${s.slice(0, 400)}...`;
  return `[json] ${s}`;
}

async function main() {
  log('--- voice-session-probe start ---');
  let token;
  try {
    token = await mintTokenDirect();
  } catch (err) {
    log('FAILED to mint token:', err.message);
    log('TODO: could not bypass auth without DATABASE_URL or matching agent.');
    process.exit(2);
  }

  const url = WS_URL_BASE + token;
  log('connecting to', url);
  const ws = new WebSocket(url, {
    perMessageDeflate: false,
    headers: { Origin: 'http://localhost:3000' },
  });

  let opened = false;
  let inboundJson = 0;
  let inboundBinary = 0;
  let inboundBinaryBytes = 0;

  ws.on('upgrade', (res) => {
    log('http upgrade response status=', res.statusCode);
  });
  ws.on('unexpected-response', (_req, res) => {
    log('UNEXPECTED HTTP RESPONSE status=', res.statusCode);
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => log('  body:', body));
  });

  ws.on('open', () => {
    opened = true;
    log('WS OPEN');
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      inboundBinary++;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      inboundBinaryBytes += buf.length;
      // Only log first 5 binary frames + every 50th to avoid flood
      if (inboundBinary <= 5 || inboundBinary % 50 === 0) {
        log('RX', describeFrame(data, true));
      }
    } else {
      inboundJson++;
      log('RX', describeFrame(data, false));
    }
  });

  ws.on('error', (err) => {
    log('WS ERROR:', err.message || err.code || String(err), 'code=', err.code);
  });

  ws.on('close', (code, reason) => {
    log('WS CLOSE code=', code, 'reason=', reason?.toString());
  });

  // After 1s start streaming silence
  setTimeout(() => {
    if (!opened) {
      log('socket never opened — skipping audio send');
      return;
    }
    log('starting silence stream: 320 int16 zeros = 640 bytes every 20ms for 3s');
    const silence = Buffer.alloc(640); // already zero-filled
    let frames = 0;
    const interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval);
        return;
      }
      ws.send(silence, { binary: true });
      frames++;
    }, 20);
    setTimeout(() => {
      clearInterval(interval);
      log('silence stream done, sent', frames, 'frames =', frames * 640, 'bytes');
    }, 3000);
  }, 1000);

  // Close at 6s
  setTimeout(() => {
    log('--- summary ---');
    log('inbound JSON frames :', inboundJson);
    log('inbound binary frames:', inboundBinary, '(', inboundBinaryBytes, 'bytes)');
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'bye' }));
      } catch {}
      ws.close(1000, 'probe done');
    }
    setTimeout(() => process.exit(0), 500);
  }, 6000);
}

main().catch((err) => {
  console.error('probe crashed:', err);
  process.exit(1);
});
