-- Telephony credentials per workspace. Stores per-tenant carrier API keys
-- (Twilio / Exotel / Plivo / Vonage) used by the voice gateway to place and
-- receive calls. The auth token is stored as AES-256-GCM ciphertext —
-- TELEPHONY_ENC_KEY (env) is the symmetric key; the column packs
-- base64(IV ‖ ciphertext ‖ authTag).
--
-- Multi-tenancy is enforced by RLS, mirroring 0002_rls.sql: every read/write
-- requires `app.workspace_id` to match the row's workspace_id.

CREATE TABLE telephony_credentials (
  id                    BIGSERIAL PRIMARY KEY,
  workspace_id          BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL, -- 'twilio' | 'exotel' | 'plivo' | 'vonage'
  account_sid           TEXT NOT NULL,
  auth_token_encrypted  TEXT NOT NULL, -- AES-256-GCM ciphertext (b64 IV‖ciphertext‖tag)
  phone_number          TEXT NOT NULL, -- E.164
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX telephony_credentials_uniq ON telephony_credentials(workspace_id, provider, phone_number);
CREATE INDEX telephony_credentials_ws_idx ON telephony_credentials(workspace_id);

ALTER TABLE telephony_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY telephony_credentials_ws_isolation ON telephony_credentials
  USING (workspace_id = current_workspace_id())
  WITH CHECK (workspace_id = current_workspace_id());

-- Conversations: carry the carrier-side call identifier (Twilio CallSid, etc.)
-- so inbound webhooks (status callbacks, recording-ready) can be matched back
-- to the originating conversation row.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS external_call_sid TEXT;
CREATE INDEX IF NOT EXISTS conversations_external_call_sid_idx ON conversations(external_call_sid);
