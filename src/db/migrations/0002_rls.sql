-- Row-level security: every tenant table denies access unless `app.workspace_id`
-- matches the row's workspace_id. The application layer sets this GUC via
-- `SET LOCAL app.workspace_id = <id>` inside withWorkspace() (src/db/client.ts).
--
-- Tables WITHOUT RLS:
--   workspaces, users — these are looked up by other keys (slug, email) during
--   sign-up/sign-in, before a workspace context exists.
--   memberships — used to resolve workspace_id on login. The application enforces
--   that only the user's own memberships are read.

-- Helper: read the current workspace_id GUC. Returns NULL if not set, which
-- causes USING (workspace_id = NULL) to be FALSE — i.e. zero rows visible.
CREATE OR REPLACE FUNCTION current_workspace_id() RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::BIGINT
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'api_keys',
      'agents',
      'agent_versions',
      'agent_lead_fields',
      'knowledge_files',
      'knowledge_chunks',
      'conversations',
      'messages'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END$$;

-- Per-table policies. agent_versions and agent_lead_fields don't carry workspace_id
-- directly — they're scoped via their parent agent.

CREATE POLICY tenant_isolation ON api_keys
  USING (workspace_id = current_workspace_id())
  WITH CHECK (workspace_id = current_workspace_id());

CREATE POLICY tenant_isolation ON agents
  USING (workspace_id = current_workspace_id())
  WITH CHECK (workspace_id = current_workspace_id());

CREATE POLICY tenant_isolation ON agent_versions
  USING (
    EXISTS (SELECT 1 FROM agents a WHERE a.id = agent_versions.agent_id
            AND a.workspace_id = current_workspace_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM agents a WHERE a.id = agent_versions.agent_id
            AND a.workspace_id = current_workspace_id())
  );

CREATE POLICY tenant_isolation ON agent_lead_fields
  USING (
    EXISTS (SELECT 1 FROM agents a WHERE a.id = agent_lead_fields.agent_id
            AND a.workspace_id = current_workspace_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM agents a WHERE a.id = agent_lead_fields.agent_id
            AND a.workspace_id = current_workspace_id())
  );

CREATE POLICY tenant_isolation ON knowledge_files
  USING (workspace_id = current_workspace_id())
  WITH CHECK (workspace_id = current_workspace_id());

CREATE POLICY tenant_isolation ON knowledge_chunks
  USING (workspace_id = current_workspace_id())
  WITH CHECK (workspace_id = current_workspace_id());

CREATE POLICY tenant_isolation ON conversations
  USING (workspace_id = current_workspace_id())
  WITH CHECK (workspace_id = current_workspace_id());

CREATE POLICY tenant_isolation ON messages
  USING (workspace_id = current_workspace_id())
  WITH CHECK (workspace_id = current_workspace_id());
