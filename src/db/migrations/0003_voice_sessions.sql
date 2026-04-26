-- Short-lived voice session tokens. Bridges the Next.js Route Handler (mints
-- the token) and the WebSocket upgrade handler (consumes it). Postgres because
-- both code paths can hit the same DB even if they're in different webpack
-- module graphs / processes.

CREATE TABLE voice_sessions (
  token         TEXT PRIMARY KEY,
  workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id      BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX voice_sessions_expires_idx ON voice_sessions (expires_at);
