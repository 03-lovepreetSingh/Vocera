/**
 * Probe each candidate Gemini chat model with a tiny request and report which
 * are 200 vs 429 vs 4xx. Used to discover models whose free-tier quota isn't
 * exhausted on this project. Read-only diagnostic.
 *
 *   pnpm tsx scripts/gemini-quota-scan.mjs
 */
import 'dotenv/config';

const key = process.env.GOOGLE_GEMINI_API_KEY;
if (!key) {
  console.error('GOOGLE_GEMINI_API_KEY not set');
  process.exit(1);
}

const CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-pro-latest',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview',
];

async function probe(model) {
  const startedAt = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
    });
    const ms = Date.now() - startedAt;
    const text = await res.text();
    let detail = '';
    try {
      const json = JSON.parse(text);
      const reply = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const block = json.promptFeedback?.blockReason;
      detail = reply ? `reply="${reply.trim().slice(0, 40)}"` : block ? `blocked=${block}` : (json.error?.message ?? '').slice(0, 100);
    } catch {
      detail = text.slice(0, 100);
    }
    return { model, status: res.status, ms, detail };
  } catch (err) {
    return { model, status: -1, ms: Date.now() - startedAt, detail: String(err).slice(0, 100) };
  }
}

console.log('Probing', CANDIDATES.length, 'models in parallel...\n');
const results = await Promise.all(CANDIDATES.map(probe));

// Sort: 200 first, then by status
results.sort((a, b) => {
  const aOk = a.status === 200 ? 0 : 1;
  const bOk = b.status === 200 ? 0 : 1;
  return aOk - bOk || a.status - b.status;
});

console.log('STATUS  MS    MODEL                              DETAIL');
console.log('──────  ────  ─────────────────────────────────  ──────');
for (const r of results) {
  const tag = r.status === 200 ? '  OK  ' : r.status === 429 ? ' 429  ' : `${String(r.status).padStart(4)} `;
  const ms = String(r.ms).padStart(4);
  const model = r.model.padEnd(34);
  console.log(`${tag}  ${ms}  ${model}  ${r.detail}`);
}

const ok = results.filter((r) => r.status === 200);
console.log('\n────────────────────────────────────────');
console.log('Models with quota left:', ok.length, '/', results.length);
if (ok.length) {
  console.log('Recommended swap order (fastest first):');
  ok.sort((a, b) => a.ms - b.ms);
  for (const r of ok) console.log(' ', r.model, `(${r.ms}ms)`);
}
