-- The actual LLM in use is Gemini 1.5 Flash (LLM_PROVIDER=gemini in .env).
-- Update the column default and rewrite any rows that still say 'claude-haiku-4-5'
-- by mistake from earlier migrations.
ALTER TABLE agent_versions ALTER COLUMN llm_model SET DEFAULT 'gemini-1.5-flash';
UPDATE agent_versions SET llm_model = 'gemini-1.5-flash'
  WHERE llm_model = 'claude-haiku-4-5';
