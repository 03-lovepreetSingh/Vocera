import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Workspaces — top tenant boundary. RLS keys off id.
export const workspaces = pgTable('workspaces', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  externalId: text('external_id').notNull().unique(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  dataRegion: text('data_region').notNull().default('us'),
  plan: text('plan').notNull().default('free'),
  spendCapCents: integer('spend_cap_cents'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    externalId: text('external_id').notNull().unique(),
    email: text('email').notNull(),
    name: text('name'),
    passwordHash: text('password_hash'),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Treat email as case-insensitive at the index level.
    emailUniq: uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
  }),
);

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: bigint('workspace_id', { mode: 'number' })
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'admin' | 'member' | 'viewer'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId, t.userId] }),
    userIdx: index('memberships_user_idx').on(t.userId),
  }),
);

export const apiKeys = pgTable('api_keys', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  externalId: text('external_id').notNull().unique(),
  workspaceId: bigint('workspace_id', { mode: 'number' })
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(), // shown in UI, e.g. "voc_live_3a2b9c"
  hash: text('hash').notNull(), // argon2id of the secret
  scope: text('scope').notNull().default('live'), // 'live' | 'test'
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
