/**
 * Members tab — list memberships for the current workspace + invite by email.
 *
 * Reads memberships joined to users so we can show display name + email + role.
 * Only admins see the invite form (and the API rejects non-admin invites too).
 */
import { eq } from 'drizzle-orm';
import { withWorkspace } from '@/db/client';
import { memberships, users } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { inviteMemberAction } from '../actions';
import { Card, Field, SelectInput, SubmitButton, TextInput } from '../fields';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
];

export default async function MembersSettingsPage() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  const isAdmin = session?.user?.role === 'admin';

  const rows = wsId
    ? await withWorkspace(wsId, (tx) =>
        tx
          .select({
            userExternalId: users.externalId,
            email: users.email,
            name: users.name,
            role: memberships.role,
            joinedAt: memberships.createdAt,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(eq(memberships.workspaceId, wsId)),
      )
    : [];

  return (
    <>
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Members</h1>
        <p className="mt-1 text-xs text-ink-3">
          People with access to this workspace. Admins can invite, change roles, and remove.
        </p>
      </header>

      {isAdmin ? (
        <Card
          title="Invite a teammate"
          description="They'll receive an email with a sign-in link."
        >
          <form action={inviteMemberAction}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto]">
              <Field label="Email">
                <TextInput name="email" type="email" placeholder="teammate@company.com" required />
              </Field>
              <Field label="Role">
                <SelectInput name="role" defaultValue="member" options={ROLE_OPTIONS} />
              </Field>
              <div className="flex items-end">
                <SubmitButton>Send invite</SubmitButton>
              </div>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={`Members (${rows.length})`}>
        <ul className="divide-y divide-line-softer">
          {rows.map((m) => (
            <li
              key={m.userExternalId}
              className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{m.name ?? m.email}</div>
                <div className="truncate font-mono text-xs text-ink-3">{m.email}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded-md border border-line-soft bg-fill px-2 py-0.5 text-xs capitalize text-ink-2">
                  {m.role}
                </span>
                {isAdmin ? (
                  <span className="text-xs text-ink-4">manage</span>
                ) : null}
              </div>
            </li>
          ))}
          {rows.length === 0 ? (
            <li className="py-4 text-sm text-ink-3">No members yet.</li>
          ) : null}
        </ul>
      </Card>
    </>
  );
}
