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
      max_tokens: 512,
      temperature: opts.temperature ?? 0.3,
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

async function* streamGemini(opts: ChatStreamOptions): AsyncGenerator<TokenChunk> {
  const model = gemini().getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: opts.systemPrompt,
    generationConfig: { temperature: opts.temperature ?? 0.3, maxOutputTokens: 512 },
  });

  const history = opts.history
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const last = history.pop();
  const chat = model.startChat({ history });

  const stream = await chat.sendMessageStream(last?.parts ?? [{ text: '' }]);
  for await (const chunk of stream.stream) {
    const delta = chunk.text();
    if (delta) yield { delta };
    if (opts.signal?.aborted) break;
  }
  const final = await stream.response;
  yield {
    delta: '',
    inputTokens: final.usageMetadata?.promptTokenCount,
    outputTokens: final.usageMetadata?.candidatesTokenCount,
  };
}
