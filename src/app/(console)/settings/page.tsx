/**
 * Profile tab — the default Settings landing page.
 *
 * Reads the current user record directly from the DB so we always show the
 * latest name/photo (the JWT carries email + ids only). Form posts to the
 * `updateProfileAction` server action which writes through to `users` and
 * revalidates this path.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { updateProfileAction } from './actions';
import { Card, Field, SelectInput, SubmitButton, TextInput } from './fields';

const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export default async function ProfileSettingsPage() {
  const session = await auth();
  const userId = session?.user?.userIdNum;

  // Defensive load: middleware should already gate this route, but if the
  // session somehow lacks a user we render an empty placeholder rather than
  // crashing on the DB call.
  const user = userId
    ? (
        await db
          .select({
            email: users.email,
            name: users.name,
            image: users.image,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
      )[0]
    : null;

  return (
    <>
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Profile</h1>
        <p className="mt-1 text-xs text-ink-3">Your personal info and preferences.</p>
      </header>

      <form action={updateProfileAction}>
        <Card title="Identity" description="Visible to your workspace teammates.">
          <div className="mb-5 flex items-center gap-4">
            <div
              className="h-14 w-14 shrink-0 rounded-full bg-accent-soft"
              style={
                user?.image
                  ? {
                      backgroundImage: `url(${user.image})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : undefined
              }
              aria-label="Avatar"
            />
            <div className="text-xs text-ink-3">
              Paste a public image URL below — JPG or PNG, ideally square.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <TextInput name="name" defaultValue={user?.name ?? ''} required />
            </Field>
            <Field label="Email" hint="Used for sign-in. Contact support to change.">
              <TextInput
                name="email"
                type="email"
                defaultValue={user?.email ?? session?.user?.email ?? ''}
                readOnly
              />
            </Field>
            <Field label="Photo URL">
              <TextInput
                name="image"
                type="url"
                defaultValue={user?.image ?? ''}
                placeholder="https://…"
              />
            </Field>
            <Field label="Role" hint="Your role in this workspace.">
              <TextInput name="role" defaultValue={session?.user?.role ?? 'member'} readOnly />
            </Field>
            <Field label="Timezone">
              <SelectInput
                name="timezone"
                defaultValue="UTC"
                options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
              />
            </Field>
          </div>
        </Card>

        <div className="flex justify-end">
          <SubmitButton>Save changes</SubmitButton>
        </div>
      </form>
    </>
  );
}
