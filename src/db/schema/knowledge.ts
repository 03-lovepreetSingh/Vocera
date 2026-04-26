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

export const knowledgeFiles = pgTable(
  'knowledge_files',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    externalId: text('external_id').notNull().unique(),
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: bigint('agent_id', { mode: 'number' })
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(), // local FS path in MVP, S3 key in prod
    sourceType: text('source_type').notNull().default('upload'), // upload|url|notion
    sourceUrl: text('source_url'),
    status: text('status').notNull().default('pending'), // pending|indexing|indexed|failed
    errorMessage: text('error_message'),
    chunkCount: integer('chunk_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
  },
  (t) => ({ agentIdx: index('kf_agent_idx').on(t.agentId) }),
);

// One row per chunk; the embedding itself lives in Pinecone, keyed by externalId.
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    externalId: text('external_id').notNull().unique(), // also the Pinecone vector id
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: bigint('agent_id', { mode: 'number' })
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    fileId: bigint('file_id', { mode: 'number' })
      .notNull()
      .references(() => knowledgeFiles.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    agentVersion: integer('agent_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ agentIdx: index('kc_agent_idx').on(t.agentId, t.agentVersion) }),
);
