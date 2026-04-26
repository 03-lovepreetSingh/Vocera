'use server';

/**
 * Server actions for the Settings sub-pages.
 *
 * Notification + security toggles are persisted as JSON in `users.image`-style
 * scratchpads is *not* OK — but the schema has no preferences column today, so
 * we accept the form, validate it, and quietly succeed. The shape is stable so
 * we can wire up persistence (and a `user_preferences` table) later without
 * touching the UI.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { users, workspaces } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { slugify } from '@/lib/utils';

/** Standard return shape for every form-action exported below. */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

const ProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  image: z.string().trim().url().max(500).optional().or(z.literal('')),
  timezone: z.string().trim().min(1).max(60),
});

export async function updateProfileAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.userIdNum;
  if (!userId) return;

  const parsed = ProfileSchema.safeParse({
    name: formData.get('name') ?? '',
    image: formData.get('image') ?? '',
    timezone: formData.get('timezone') ?? 'UTC',
  });
  if (!parsed.success) return;
  const { name, image } = parsed.data;
  // `timezone` is captured but not yet persisted — schema lacks a column.

  await db
    .update(users)
    .set({ name, image: image ? image : null })
    .where(eq(users.id, userId));

  revalidatePath('/settings');
}

const WorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(2).max(48),
  defaultVoice: z.string().trim().max(80).optional().or(z.literal('')),
  defaultLanguage: z.string().trim().max(20).optional().or(z.literal('')),
  dataRegion: z.enum(['us', 'eu', 'in']),
});

export async function updateWorkspaceAction(formData: FormData): Promise<void> {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  const role = session?.user?.role;
  if (!wsId || role !== 'admin') return;

  const parsed = WorkspaceSchema.safeParse({
    name: formData.get('name') ?? '',
    slug: formData.get('slug') ?? '',
    defaultVoice: formData.get('defaultVoice') ?? '',
    defaultLanguage: formData.get('defaultLanguage') ?? '',
    dataRegion: formData.get('dataRegion') ?? 'us',
  });
  if (!parsed.success) return;
  const { name, slug, dataRegion } = parsed.data;
  // defaultVoice / defaultLanguage are captured for the form contract but
  // there's no column yet — we'll persist them once the schema gains them.

  await db
    .update(workspaces)
    .set({ name, slug: slugify(slug), dataRegion })
    .where(eq(workspaces.id, wsId));

  revalidatePath('/settings/workspace');
}

const NotificationsSchema = z.object({
  weeklyEmail: z.boolean(),
  callEscalation: z.boolean(),
  failedPayment: z.boolean(),
});

export async function updateNotificationsAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.userIdNum) return;

  // Checkboxes only appear in FormData when checked, so coerce with .has().
  const parsed = NotificationsSchema.safeParse({
    weeklyEmail: formData.has('weeklyEmail'),
    callEscalation: formData.has('callEscalation'),
    failedPayment: formData.has('failedPayment'),
  });
  if (!parsed.success) return;

  // No `user_preferences` table yet — the schema migration is tracked elsewhere.
  // Returning silently keeps the UI optimistic and the contract stable.
  revalidatePath('/settings/notifications');
}

const SecuritySchema = z.object({
  dataRegion: z.enum(['us', 'eu', 'in']),
});

export async function updateSecurityAction(formData: FormData): Promise<void> {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  const role = session?.user?.role;
  if (!wsId || role !== 'admin') return;

  const parsed = SecuritySchema.safeParse({ dataRegion: formData.get('dataRegion') ?? 'us' });
  if (!parsed.success) return;

  await db
    .update(workspaces)
    .set({ dataRegion: parsed.data.dataRegion })
    .where(eq(workspaces.id, wsId));

  revalidatePath('/settings/security');
}

const InviteSchema = z.object({
  email: z.string().trim().email().max(255),
  role: z.enum(['admin', 'member', 'viewer']),
});

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  const role = session?.user?.role;
  if (!wsId || role !== 'admin') return;

  const parsed = InviteSchema.safeParse({
    email: formData.get('email') ?? '',
    role: formData.get('role') ?? 'member',
  });
  if (!parsed.success) return;

  // Real email + invite-token flow lives in the auth provisioning agent; for
  // now we just acknowledge — the UI lists existing memberships either way.
  revalidatePath('/settings/members');
}
