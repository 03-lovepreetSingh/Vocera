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
