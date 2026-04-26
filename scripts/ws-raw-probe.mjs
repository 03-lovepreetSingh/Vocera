// Raw WebSocket upgrade probe — sends a manual Upgrade request via a raw TCP
// socket and prints the bytes the server writes back. Used to diagnose
// whether `/ws/voice/:token` is producing a valid HTTP/1.1 101 handshake or
// emitting garbage / a bare HTTP error.

import net from 'node:net';
import crypto from 'node:crypto';

const HOST = '127.0.0.1';
const PORT = 3000;
const PATH = '/ws/voice/test-token-12345';

const key = crypto.randomBytes(16).toString('base64');

const req =
  `GET ${PATH} HTTP/1.1\r\n` +
  `Host: ${HOST}:${PORT}\r\n` +
  `Upgrade: websocket\r\n` +
  `Connection: Upgrade\r\n` +
  `Sec-WebSocket-Key: ${key}\r\n` +
  `Sec-WebSocket-Version: 13\r\n` +
  `Origin: http://${HOST}:${PORT}\r\n` +
  `User-Agent: vocera-raw-probe/1.0\r\n` +
  `\r\n`;

function dump(buf, label) {
  console.log(`\n--- ${label} (${buf.length} bytes) ---`);
  const slice = buf.subarray(0, Math.min(buf.length, 1000));
  for (let off = 0; off < slice.length; off += 16) {
    const chunk = slice.subarray(off, off + 16);
    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(16 * 3 - 1, ' ');
    const ascii = Array.from(chunk)
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('');
    console.log(`${off.toString(16).padStart(4, '0')}  ${hex}  |${ascii}|`);
  }
  if (buf.length > 1000) {
    console.log(`... (${buf.length - 1000} more bytes truncated)`);
  }
}

const sock = net.createConnection({ host: HOST, port: PORT }, () => {
  console.log(`[connect] ${HOST}:${PORT} OK`);
  console.log(`[send] ${req.length} bytes:`);
  console.log(req.replace(/\r/g, '\\r').replace(/\n/g, '\\n\n'));
  sock.write(req);
});

let initialChunks = [];
let postChunks = [];
let handshakeDone = false;
const start = Date.now();

sock.on('data', (chunk) => {
  const t = Date.now() - start;
  console.log(`[data +${t}ms] +${chunk.length} bytes`);
  if (!handshakeDone) {
    initialChunks.push(chunk);
  } else {
    postChunks.push(chunk);
  }
});

sock.on('error', (err) => {
  console.log(`[error] ${err.message}`);
});

sock.on('close', (hadErr) => {
  console.log(`[close] hadError=${hadErr} t=${Date.now() - start}ms`);
  // Dump whatever we got, regardless of whether the 500ms timer fired.
  const all = Buffer.concat([...initialChunks, ...postChunks]);
  dump(all, 'ALL BYTES RECEIVED BEFORE CLOSE');
  const headerEnd = all.indexOf('\r\n\r\n');
  if (headerEnd >= 0) {
    console.log('\n--- PARSED HEADERS ---');
    console.log(all.subarray(0, headerEnd).toString('utf8'));
    const body = all.subarray(headerEnd + 4);
    if (body.length > 0) dump(body, 'BYTES AFTER \\r\\n\\r\\n');
    else console.log('(no bytes after \\r\\n\\r\\n)');
  } else {
    console.log('[parse] No \\r\\n\\r\\n found in received bytes.');
    console.log('[parse] Raw as utf8:', JSON.stringify(all.toString('utf8')));
  }
  setTimeout(() => process.exit(0), 100);
});

// After 500ms treat what we have so far as the "initial" handshake response,
// then collect anything else for the next 3 seconds.
setTimeout(() => {
  handshakeDone = true;
  const initial = Buffer.concat(initialChunks);
  dump(initial, 'INITIAL RESPONSE');

  // Try to parse status line
  const headerEnd = initial.indexOf('\r\n\r\n');
  if (headerEnd >= 0) {
    const headerText = initial.subarray(0, headerEnd).toString('utf8');
    console.log('\n--- PARSED HEADERS ---');
    console.log(headerText);
    const body = initial.subarray(headerEnd + 4);
    if (body.length > 0) {
      dump(body, 'POST-HEADER BYTES IN INITIAL CHUNK');
    } else {
      console.log('(no bytes after \\r\\n\\r\\n in initial response)');
    }
  } else {
    console.log('\n[parse] No \\r\\n\\r\\n found — not a valid HTTP response header.');
  }
}, 500);

setTimeout(() => {
  const post = Buffer.concat(postChunks);
  if (post.length > 0) {
    dump(post, 'POST-HANDSHAKE BYTES (after 500ms, within 3s window)');
    // Try to interpret as WS frame
    const b0 = post[0];
    const fin = (b0 & 0x80) >> 7;
    const opcode = b0 & 0x0f;
    console.log(`\n[ws-frame?] first byte=0x${b0.toString(16).padStart(2, '0')} fin=${fin} opcode=0x${opcode.toString(16)} (0x1=text, 0x2=binary, 0x8=close, 0x9=ping, 0xA=pong)`);
  } else {
    console.log('\n[post] no additional bytes in 3s window after handshake');
  }
  try { sock.end(); } catch {}
  setTimeout(() => process.exit(0), 200);
}, 3500);

function finalize() {
  // Just ensures we exit even if the close happens before timers
  setTimeout(() => process.exit(0), 100);
}
