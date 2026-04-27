/**
 * LLM router. Supports Anthropic Claude Haiku 4.5 (default) and Google Gemini
 * 1.5 Flash (free-tier alt). Returns an async iterator of text deltas.
 *
 * The pipeline cancels by calling `.return()` on the iterator (or via AbortSignal),
 * which is critical for sub-100ms barge-in.
 */
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatStreamOptions {
  systemPrompt: string;
  history: ChatMessage[];
  signal?: AbortSignal;
  /** Hint to the provider — both Anthropic and Gemini honor a top-level temperature. */
  temperature?: number;
}

export interface TokenChunk {
  delta: string;
  /** Final tally — emitted in the last yield only. */
  inputTokens?: number;
  outputTokens?: number;
}

const PROVIDER = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase() as 'anthropic' | 'gemini';

export async function* streamCompletion(opts: ChatStreamOptions): AsyncGenerator<TokenChunk> {
  if (PROVIDER === 'gemini') {
    yield* streamGemini(opts);
    return;
  }
  yield* streamAnthropic(opts);
}

// ─── Anthropic ───────────────────────────────────────────────
let _anthropic: Anthropic | null = null;
function anthropic() {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

async function* streamAnthropic(opts: ChatStreamOptions): AsyncGenerator<TokenChunk> {
  const messages = opts.history
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const stream = anthropic().messages.stream(
    {
      model: 'claude-haiku-4-5',
      // Bumped from 512 — voice replies should occasionally run longer when
      // the user asks for detail. 1024 still keeps cost low.
      max_tokens: 1024,
      // Bumped from 0.3 — natural conversational variance helps the agent
      // sound less like a teleprompter.
      temperature: opts.temperature ?? 0.7,
      // Prompt caching is enabled via beta header — we'll add it once the
      // multi-turn loop is verified working. For now: plain system prompt.
      system: opts.systemPrompt,
      messages,
    },
    { signal: opts.signal },
  );

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield { delta: event.delta.text };
    } else if (event.type === 'message_delta') {
      outputTokens = event.usage?.output_tokens;
    } else if (event.type === 'message_start') {
      inputTokens = event.message.usage?.input_tokens;
    }
  }
  yield { delta: '', inputTokens, outputTokens };
}

// ─── Gemini ──────────────────────────────────────────────────
let _gemini: GoogleGenerativeAI | null = null;
function gemini() {
  if (_gemini) return _gemini;
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GEMINI_API_KEY not set');
  _gemini = new GoogleGenerativeAI(apiKey);
  return _gemini;
}

/**
 * Free-tier-friendly fallback chain. We attempt each model in order; on a
 * 429 (quota) or 404 (deprecated/unavailable) error we fall through to the
 * next.
 *
 * Order is empirically tuned: `gemini-2.5-flash-lite` has separate (often
 * un-exhausted) free-tier streaming quota from the heavier Flash variants
 * and consistently replies under 1.5s. Heavier models follow as fallbacks.
 *
 * NOTE: only models that support `generateContent` belong here. TTS-suffixed
 * models (e.g. `gemini-3.1-flash-tts-preview`) generate audio only and would
 * 400 with "method not supported".
 */
const GEMINI_MODEL_CHAIN = [
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash-lite',   // independent quota bucket — usually free even when other Flash models 429
  'gemini-2.5-flash',        // proven fast (~2s), full replies
  'gemini-flash-latest',     // alias to current Flash, often shares quota with above
  'gemini-3-flash-preview',  // preview — sometimes returns truncated
  'gemini-2.0-flash',        // free-tier daily quota often exhausted but try
].filter(Boolean) as string[];

async function* streamGemini(opts: ChatStreamOptions): AsyncGenerator<TokenChunk> {
  let lastErr: unknown = null;
  for (const modelName of GEMINI_MODEL_CHAIN) {
    try {
      yield* streamGeminiOne(modelName, opts);
      return; // succeeded
    } catch (err) {
      lastErr = err;
      const msg = String(err);
      const transient = /\b(429|404|503|RESOURCE_EXHAUSTED|UNAVAILABLE)\b/i.test(msg);
      if (!transient) throw err;
      console.warn(`[gemini] ${modelName} failed (${msg.slice(0, 120)}), trying next model`);
    }
  }
  throw lastErr ?? new Error('Gemini: all models exhausted');
}

async function* streamGeminiOne(
  modelName: string,
  opts: ChatStreamOptions,
): AsyncGenerator<TokenChunk> {
  const model = gemini().getGenerativeModel({
    model: modelName,
    systemInstruction: opts.systemPrompt,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: 1024,
      topP: 0.95,
      topK: 40,
    },
  });

  // Gemini chat history MUST start with role='user' and the message we send
  // MUST be a user message. If our seeded greeting (an assistant turn) is the
  // first or only entry, Gemini rejects the request and returns 0 tokens.
  const mapped = opts.history
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content }],
    }));

  // Drop any leading model turns (the greeting seeded as assistant).
  while (mapped.length && mapped[0].role === 'model') mapped.shift();

  // Pop the last user message — that's what we send to sendMessageStream.
  // If for some reason the last is 'model', synthesize an empty user prompt
  // (rare; mainly a defensive guard).
  let userMessage: { role: 'user' | 'model'; parts: { text: string }[] } | undefined;
  if (mapped.length && mapped[mapped.length - 1].role === 'user') {
    userMessage = mapped.pop();
  }
  // Remaining mapped[] is the chat history (alternating user/model starting
  // with user). If the resulting history would END on a user turn (because we
  // didn't pop anything), drop the trailing user so history alternates
  // cleanly user→model→user→… up to (not including) our message.
  while (mapped.length && mapped[mapped.length - 1].role === 'user') mapped.pop();

  const chat = model.startChat({ history: mapped });
  console.log(
    '[gemini] startChat history.length=',
    mapped.length,
    'sendMessage text=',
    JSON.stringify((userMessage?.parts?.[0]?.text ?? '').slice(0, 100)),
  );
  const stream = await chat.sendMessageStream(
    userMessage?.parts ?? [{ text: '(continue the conversation)' }],
  );

  let geminiChunks = 0;
  for await (const chunk of stream.stream) {
    if (opts.signal?.aborted) break;
    const delta = chunk.text();
    if (delta) {
      geminiChunks++;
      yield { delta };
    }
  }
  console.log('[gemini] stream done, chunks=', geminiChunks);
  try {
    const final = await stream.response;
    const block = (final as unknown as { promptFeedback?: { blockReason?: string } })
      .promptFeedback?.blockReason;
    if (block) console.warn('[gemini] response blocked:', block);
    yield {
      delta: '',
      inputTokens: final.usageMetadata?.promptTokenCount,
      outputTokens: final.usageMetadata?.candidatesTokenCount,
    };
  } catch (err) {
    console.warn('[gemini] response settle failed', err);
    yield { delta: '' };
  }
}
