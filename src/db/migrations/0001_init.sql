-- Vocera initial schema
-- Mirrors src/db/schema/*.ts. Hand-written so it can be applied without drizzle-kit.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── tenancy ────────────────────────────────────────────────
CREATE TABLE workspaces (
  id              BIGSERIAL PRIMARY KEY,
  external_id     TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  data_region     TEXT NOT NULL DEFAULT 'us',
  plan            TEXT NOT NULL DEFAULT 'free',
  spend_cap_cents INTEGER,
  stripe_customer_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  external_id   TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  name          TEXT,
  password_hash TEXT,
  image         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE memberships (
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE api_keys (
  id            BIGSERIAL PRIMARY KEY,
  external_id   TEXT NOT NULL UNIQUE,
  workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  hash          TEXT NOT NULL,
  scope         TEXT NOT NULL DEFAULT 'live' CHECK (scope IN ('live','test')),
  last_used_at  TIMESTAMPTZ,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);

-- ─── agents ─────────────────────────────────────────────────
CREATE TABLE agents (
  id              BIGSERIAL PRIMARY KEY,
  external_id     TEXT NOT NULL UNIQUE,
  workspace_id    BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  industry        TEXT,
  audience        TEXT,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','archived')),
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agents_ws_idx ON agents (workspace_id);

CREATE TABLE agent_versions (
  id                   BIGSERIAL PRIMARY KEY,
  agent_id             BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version              INTEGER NOT NULL,
  system_prompt        TEXT NOT NULL,
  llm_model            TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
  llm_temperature      REAL NOT NULL DEFAULT 0.3,
  voice_provider       TEXT NOT NULL DEFAULT 'elevenlabs',
  voice_map            JSONB NOT NULL DEFAULT '{}',
  languages            TEXT[] NOT NULL DEFAULT ARRAY['en-US'],
  default_language     TEXT NOT NULL DEFAULT 'en-US',
  auto_detect_language BOOLEAN NOT NULL DEFAULT true,
  speech_speed         REAL NOT NULL DEFAULT 1.0,
  tools                JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

CREATE TABLE agent_lead_fields (
  id            BIGSERIAL PRIMARY KEY,
  agent_id      BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  field_key     TEXT NOT NULL,
  field_label   TEXT NOT NULL,
  field_type    TEXT NOT NULL CHECK (field_type IN ('string','email','phone','enum','long-text','file')),
  required      BOOLEAN NOT NULL DEFAULT false,
  options       JSONB,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (agent_id, field_key)
);

-- ─── knowledge ──────────────────────────────────────────────
CREATE TABLE knowledge_files (
  id            BIGSERIAL PRIMARY KEY,
  external_id   TEXT NOT NULL UNIQUE,
  workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id      BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  storage_key   TEXT NOT NULL,
  source_type   TEXT NOT NULL DEFAULT 'upload' CHECK (source_type IN ('upload','url','notion')),
  source_url    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','indexing','indexed','failed')),
  error_message TEXT,
  chunk_count   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  indexed_at    TIMESTAMPTZ
);
CREATE INDEX kf_agent_idx ON knowledge_files (agent_id);

CREATE TABLE knowledge_chunks (
  id            BIGSERIAL PRIMARY KEY,
  external_id   TEXT NOT NULL UNIQUE,
  workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id      BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  file_id       BIGINT NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  text          TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  agent_version INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX kc_agent_idx ON knowledge_chunks (agent_id, agent_version);

-- ─── conversations ──────────────────────────────────────────
CREATE TABLE conversations (
  id              BIGSERIAL PRIMARY KEY,
  external_id     TEXT NOT NULL UNIQUE,
  workspace_id    BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id        BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('voice','support','custom')),
  direction       TEXT CHECK (direction IN ('inbound','outbound')),
  caller_id       TEXT,
  caller_name     TEXT,
  status          TEXT NOT NULL CHECK (status IN ('in-progress','completed','escalated','missed','failed')),
  duration_ms     INTEGER,
  llm_input_tokens  INTEGER NOT NULL DEFAULT 0,
  llm_output_tokens INTEGER NOT NULL DEFAULT 0,
  audio_storage_key TEXT,
  intent          TEXT,
  sentiment       TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  detected_languages TEXT[],
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);
CREATE INDEX conv_ws_started_idx ON conversations (workspace_id, started_at DESC);
CREATE INDEX conv_agent_started_idx ON conversations (agent_id, started_at DESC);

CREATE TABLE messages (
  id              BIGSERIAL PRIMARY KEY,
  workspace_id    BIGINT NOT NULL,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_index      INTEGER NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user','agent','tool','system')),
  content         TEXT NOT NULL,
  language        TEXT,
  tool_name       TEXT,
  tool_input      JSONB,
  tool_output     JSONB,
  ttft_ms         INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON messages (conversation_id, turn_index);
