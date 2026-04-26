# Vocera

Voice + chat AI agents grounded in your knowledge base. Multilingual, low-latency,
self-hostable. Local-first MVP.

## What's working

- Sign-up + login (email/password; optional Google OAuth)
- Create-AI-Agent wizard with multilingual support (24 languages out of the box)
- Knowledge upload (PDF, DOCX, MD, TXT) → Pinecone (chunk → embed → upsert)
- "Talk to agent" — browser mic → STT → LLM (with retrieval) → TTS → speaker
- SSE chat endpoint (text-only sanity check)
- Postgres with row-level security per workspace
- Conversation/transcript logs

## Stack

- **Frontend**: Next.js 14 (App Router) + React + Tailwind
- **Backend**: Next.js Route Handlers + a custom WS server in the same Node process
- **DB**: Postgres (you provide the URL — Neon / Supabase / etc.) + Pinecone (free Starter tier)
- **AI**: Deepgram Nova-3 (STT) · Anthropic Claude Haiku 4.5 *or* Google Gemini 1.5 Flash (LLM)
  · ElevenLabs Flash v2.5 (TTS) · Voyage-3 *or* OpenAI text-embedding-3-small (embeddings)

No Docker. One process. `pnpm dev` boots everything.

## Setup

### 1. Install deps

```
pnpm install
```

### 2. Provide your Postgres URL + secrets

Copy `.env.example` to `.env` and fill in at minimum:

```
DATABASE_URL=postgres://...        # required
AUTH_SECRET=$(openssl rand -base64 32)
```

### 3. Run migrations

```
pnpm db:migrate
```

This creates all tables and the row-level security policies.

### 4. Boot

```
pnpm dev
```

Open http://localhost:3000.

## What env vars to grab and when

You can boot without anything except `DATABASE_URL` + `AUTH_SECRET`. Add more as you go — each unlocks a piece of the product.

| For… | Env vars | Free signup |
| --- | --- | --- |
| Sign in with Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | https://console.cloud.google.com — Credentials → OAuth client; redirect URI `http://localhost:3000/api/auth/callback/google` |
| Knowledge ingest | `PINECONE_API_KEY`, `PINECONE_INDEX`, `VOYAGE_API_KEY` (or `OPENAI_API_KEY`) | Pinecone free Starter (https://app.pinecone.io). Voyage 50M tokens free (https://voyageai.com). |
| Voice loop | `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY` (or `GOOGLE_GEMINI_API_KEY`), `ELEVENLABS_API_KEY` | Deepgram $200 credit · Anthropic pay-as-you-go · Gemini truly free at https://aistudio.google.com · ElevenLabs 10k chars/mo free |

For Pinecone, the index dimension must match the embedding provider:
- Voyage-3 → **1024**
- OpenAI text-embedding-3-small → **1536**

## Latency targets

Voice round-trip on a residential connection should land under ~800 ms p50 (end of your speech → first audible byte from the agent). Specific knobs:

- Streaming everywhere — no provider waits for "complete" results.
- Sentence-level TTS handoff — TTS speaks while the LLM is still writing.
- Speculative retrieval — LLM starts streaming while Pinecone is queried in parallel.
- Anthropic prompt caching — cuts ~70% of token cost and ~80 ms TTFT after the first turn.
- Single Node process — no IPC.

## Multilingual

In the Create-Agent wizard, pick any subset of 24 supported languages. Behavior:

- **STT** runs Deepgram in `multi` mode when more than one language is enabled.
- **LLM** is instructed to respond in the language the user just used.
- **TTS** picks a per-language voice from the agent's `voice_map` (overridable later).
- Caller speaks an unsupported language → polite refusal in the default language.

## Repo layout

See `src/`. Notable files:

- `server.ts` — boots Next.js + the WebSocket server (single process)
- `src/db/schema/*.ts` — Drizzle schemas; `src/db/migrations/*.sql` — DDL + RLS policies
- `src/server/auth/config.ts` — Auth.js v5
- `src/server/ai/pipeline.ts` — the canonical voice loop
- `src/server/ws/voice.ts` — WebSocket handler
- `src/server/rag/` — parse, chunk, embed, Pinecone upsert
- `src/components/wizard/` — agent creation wizard incl. language picker
- `src/components/voice/TalkButton.tsx` — browser audio + WS client

## What's next

In rough order: Twilio inbound IVR, outbound dialer, lead extraction, Stripe metered billing, support widget, async ingestion, S3 + Redis, EU residency, deploy pipeline. See the full PRD section 13 + the `/loop` planning notes.
