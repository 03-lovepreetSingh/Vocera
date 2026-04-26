/**
 * LLM probe — calls streamCompletion directly with a turn-1-style prompt+history.
 * Isolates the LLM from STT/WS/TTS so we can see exactly what Gemini returns.
 *
 * Run: tsx scripts/llm-probe.ts
 */
import 'dotenv/config';
import { buildSystemPrompt } from '../src/server/prompts.js';
import { streamCompletion, type ChatMessage } from '../src/server/ai/llm.js';

async function main() {
  const provider = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase();
  console.log('[probe] LLM_PROVIDER =', provider);
  console.log(
    '[probe] GOOGLE_GEMINI_API_KEY set?',
    Boolean(process.env.GOOGLE_GEMINI_API_KEY),
  );
  console.log(
    '[probe] ANTHROPIC_API_KEY set?',
    Boolean(process.env.ANTHROPIC_API_KEY),
  );

  const systemPrompt = buildSystemPrompt({
    purpose: 'support',
    languages: ['en-US', 'hi-IN'],
    defaultLanguage: 'en-US',
  });

  const history: ChatMessage[] = [
    {
      role: 'assistant',
      content: "Hey there — thanks for calling. What's going on?",
    },
    {
      role: 'user',
      content:
        "Hello? Hello? Can you tell me what's the service are you providing?",
    },
  ];

  console.log('[probe] systemPrompt length =', systemPrompt.length);
  console.log('[probe] history =', JSON.stringify(history, null, 2));
  console.log('[probe] calling streamCompletion...');

  const start = Date.now();
  let chunkCount = 0;
  let total = '';
  let lastChunk: { inputTokens?: number; outputTokens?: number } = {};

  try {
    for await (const chunk of streamCompletion({ systemPrompt, history })) {
      chunkCount++;
      const elapsed = Date.now() - start;
      console.log(
        `[probe] chunk #${chunkCount} t+${elapsed}ms delta=${JSON.stringify(chunk.delta)} inTok=${chunk.inputTokens ?? '-'} outTok=${chunk.outputTokens ?? '-'}`,
      );
      if (chunk.delta) total += chunk.delta;
      if (chunk.inputTokens || chunk.outputTokens) lastChunk = chunk;
    }
  } catch (err) {
    console.error('[probe] streamCompletion threw:', err);
  }

  const elapsed = Date.now() - start;
  console.log('───────────────────────────────────────────────');
  console.log('[probe] DONE');
  console.log('[probe] total chunks:', chunkCount);
  console.log('[probe] total elapsed ms:', elapsed);
  console.log('[probe] inputTokens:', lastChunk.inputTokens);
  console.log('[probe] outputTokens:', lastChunk.outputTokens);
  console.log('[probe] total text length:', total.length);
  console.log('[probe] total text:');
  console.log(total);
}

main().catch((err) => {
  console.error('[probe] fatal:', err);
  process.exit(1);
});
