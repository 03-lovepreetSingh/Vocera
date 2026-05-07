import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workspaces } from './tenancy';

export const voiceSessions = pgTable('voice_sessions', {
  token: text('token').primaryKey(),
  workspaceId: bigint('workspace_id', { mode: 'number' })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: bigint('agent_id', { mode: 'number' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agents = pgTable(
  'agents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    externalId: text('external_id').notNull().unique(),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    purpose: text('purpose').notNull(), // 'support' | 'lead-qual' | 'booking' | 'ivr' | 'outbound' | 'custom'
    industry: text('industry'),
    audience: text('audience'),
    description: text('description'),
    status: text('status').notNull().default('draft'), // 'draft' | 'live'
    currentVersion: integer('current_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ wsIdx: index('agents_ws_idx').on(t.workspaceId) }),
);

export const agentVersions = pgTable(
  'agent_versions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentId: bigint('agent_id', { mode: 'number' })
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    // Default reflects the configured LLM_PROVIDER. Override per-agent later.
    llmModel: text('llm_model').notNull().default('gemini-1.5-flash'),
    llmTemperature: real('llm_temperature').notNull().default(0.3),
    voiceProvider: text('voice_provider').notNull().default('elevenlabs'),
    // Map of language code -> voice id (e.g. {"en-US":"voice_a","hi-IN":"voice_b"}).
    // Avoids per-turn DB lookup; resolved in-process at session start.
    voiceMap: jsonb('voice_map').notNull().default({}),
    // Multilingual support — first-class.
    languages: text('languages').array().notNull().default(['en-US']),
    defaultLanguage: text('default_language').notNull().default('en-US'),
    autoDetectLanguage: boolean('auto_detect_language').notNull().default(true),
    speechSpeed: real('speech_speed').notNull().default(1.0),
    tools: jsonb('tools').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex('agent_versions_uniq').on(t.agentId, t.version) }),
);

export const agentLeadFields = pgTable(
  'agent_lead_fields',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentId: bigint('agent_id', { mode: 'number' })
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    fieldLabel: text('field_label').notNull(),
    fieldType: text('field_type').notNull(),
    required: boolean('required').notNull().default(false),
    options: jsonb('options'),
    displayOrder: integer('display_order').notNull().default(0),
  },
  (t) => ({ uniq: uniqueIndex('agent_lead_fields_uniq').on(t.agentId, t.fieldKey) }),
);

/**
 * Deployments — surfaces an agent is exposed through (voice / web-widget / sms / etc).
 * One agent can have many deployments. Workspace-scoped via RLS.
 */
export const deployments = pgTable(
  'deployments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    externalId: text('external_id').notNull().unique(),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: bigint('agent_id', { mode: 'number' })
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    surface: text('surface').notNull(), // 'voice' | 'web' | 'sms' | 'custom'
    name: text('name'),
    status: text('status').notNull().default('active'), // 'active' | 'paused' | 'archived'
    config: jsonb('config').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    wsIdx: index('deployments_ws_idx').on(t.workspaceId),
    agentIdx: index('deployments_agent_idx').on(t.agentId),
  }),
);

/**
 * Voice-specific deployment row. 1:1 with deployments where surface='voice'.
 * Carries the webhook token + signing secret used by Twilio / outbound APIs.
 */
export const voiceDeployments = pgTable(
  'voice_deployments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deploymentId: bigint('deployment_id', { mode: 'number' })
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Token embedded in the public webhook URL (https://voice.vocera.ai/ivr/wsk_xxx)
    webhookToken: text('webhook_token').notNull().unique(),
    // HMAC secret used to sign/verify outbound webhook requests.
    signingSecret: text('signing_secret').notNull(),
    // Which integration paths the user enabled — IVR, outbound, custom.
    surfaces: jsonb('surfaces').notNull().default({ ivr: true, outbound: false, custom: false }),
    // Optional ElevenLabs voice override beyond what the agent version specifies.
    voiceId: text('voice_id'),
    speechSpeed: real('speech_speed').notNull().default(1.0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deploymentIdx: uniqueIndex('voice_deployments_deployment_uniq').on(t.deploymentId),
    wsIdx: index('voice_deployments_ws_idx').on(t.workspaceId),
  }),
);

/**
 * Per-workspace telephony carrier credentials (Twilio / Exotel / Plivo / Vonage).
 * `authTokenEncrypted` is AES-256-GCM ciphertext (b64 IV‖ciphertext‖tag) using
 * TELEPHONY_ENC_KEY from env. Workspace-scoped via RLS.
 */
export const telephonyCredentials = pgTable(
  'telephony_credentials',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'twilio' | 'exotel' | 'plivo' | 'vonage'
    accountSid: text('account_sid').notNull(),
    // AES-256-GCM ciphertext (base64 IV‖ciphertext‖tag).
    authTokenEncrypted: text('auth_token_encrypted').notNull(),
    phoneNumber: text('phone_number').notNull(), // E.164
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('telephony_credentials_uniq').on(t.workspaceId, t.provider, t.phoneNumber),
    wsIdx: index('telephony_credentials_ws_idx').on(t.workspaceId),
  }),
);
