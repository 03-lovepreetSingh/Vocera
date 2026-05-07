-- Deployments: surfaces an agent is exposed through (voice / web-widget / sms / etc).
-- One agent can have many deployments. Workspace-scoped via RLS, mirroring 0002_rls.sql.
--
-- voice_deployments is a 1:1 detail row for surface='voice' deployments. It carries
-- the `webhook_token` (wsk_...) embedded in the public Twilio voice webhook URL and
-- the `signing_secret` (whsec_...) used to sign outbound webhooks Vocera fires to
-- customers. Twilio inbound auth uses the per-workspace Twilio Auth Token from
-- telephony_credentials (0005), not signing_secret.
--
-- This migration is corrective: the schema declarations exist in src/db/schema/agents.ts
-- and the deployments REST routes have been live, but no prior migration created the
-- physical tables. Runtime callers (the Twilio voice webhook in particular) hit
-- "relation \"voice_deployments\" does not exist" until this lands.

CREATE TABLE deployments (
  id            BIGSERIAL PRIMARY KEY,
  external_id   TEXT NOT NULL UNIQUE,
  workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id      BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  surface       TEXT NOT NULL, -- 'voice' | 'web' | 'sms' | 'custom'
  name          TEXT,
  status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'archived'
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deployments_ws_idx    ON deployments(workspace_id);
CREATE INDEX deployments_agent_idx ON deployments(agent_id);

CREATE TABLE voice_deployments (
  id              BIGSERIAL PRIMARY KEY,
  deployment_id   BIGINT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  workspace_id    BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  webhook_token   TEXT NOT NULL UNIQUE, -- wsk_... — public token in the Twilio voice URL
  signing_secret  TEXT NOT NULL,        -- whsec_... — for outbound webhooks Vocera fires
  surfaces        JSONB NOT NULL DEFAULT '{"ivr":true,"outbound":false,"custom":false}'::jsonb,
  voice_id        TEXT,                 -- optional ElevenLabs voice override per deployment
  speech_speed    REAL NOT NULL DEFAULT 1.0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX voice_deployments_deployment_uniq ON voice_deployments(deployment_id);
CREATE INDEX        voice_deployments_ws_idx          ON voice_deployments(workspace_id);

ALTER TABLE deployments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments       FORCE  ROW LEVEL SECURITY;
ALTER TABLE voice_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_deployments FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON deployments
  USING (workspace_id = current_workspace_id())
  WITH CHECK (workspace_id = current_workspace_id());

CREATE POLICY tenant_isolation ON voice_deployments
  USING (workspace_id = current_workspace_id())
  WITH CHECK (workspace_id = current_workspace_id());
