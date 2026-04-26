import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { workspaces } from './tenancy';

export const conversations = pgTable(
  'conversations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    externalId: text('external_id').notNull().unique(),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: bigint('agent_id', { mode: 'number' })
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(), // 'voice'|'support'|'custom'
    direction: text('direction'), // 'inbound'|'outbound'
    callerId: text('caller_id'),
    callerName: text('caller_name'),
    status: text('status').notNull(), // in-progress|completed|escalated|missed|failed
    durationMs: integer('duration_ms'),
    llmInputTokens: integer('llm_input_tokens').notNull().default(0),
    llmOutputTokens: integer('llm_output_tokens').notNull().default(0),
    audioStorageKey: text('audio_storage_key'),
    intent: text('intent'),
    sentiment: text('sentiment'),
    detectedLanguages: text('detected_languages').array(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => ({
    wsStartedIdx: index('conv_ws_started_idx').on(t.workspaceId, t.startedAt),
    agentStartedIdx: index('conv_agent_started_idx').on(t.agentId, t.startedAt),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: bigint('workspace_id', { mode: 'number' }).notNull(),
    conversationId: bigint('conversation_id', { mode: 'number' })
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    turnIndex: integer('turn_index').notNull(),
    role: text('role').notNull(), // 'user'|'agent'|'tool'|'system'
    content: text('content').notNull(),
    language: text('language'), // detected per turn
    toolName: text('tool_name'),
    toolInput: jsonb('tool_input'),
    toolOutput: jsonb('tool_output'),
    ttftMs: integer('ttft_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ convIdx: index('messages_conv_idx').on(t.conversationId, t.turnIndex) }),
);
