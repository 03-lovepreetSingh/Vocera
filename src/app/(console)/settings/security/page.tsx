/**
 * Security tab — 2FA placeholder + data residency.
 *
 * Two-factor enrollment lives in a follow-up; we surface the slot now so the
 * settings IA matches the v2 design canvas. Data residency is the same
 * `workspaces.data_region` column the Workspace tab edits — duplicating it
 * here lets security-conscious users find it where they expect.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { workspaces } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { updateSecurityAction } from '../actions';
import { Card, Field, SelectInput, SubmitButton } from '../fields';

const REGIONS = [
  { value: 'us', label: 'United States (us-east-1)' },
  { value: 'eu', label: 'European Union (eu-west-1)' },
  { value: 'in', label: 'India (ap-south-1)' },
];

export default async function SecuritySettingsPage() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  const isAdmin = session?.user?.role === 'admin';

  const workspace = wsId
    ? (
        await db
          .select({ dataRegion: workspaces.dataRegion })
          .from(workspaces)
          .where(eq(workspaces.id, wsId))
          .limit(1)
      )[0]
    : null;

  return (
    <>
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Security</h1>
        <p className="mt-1 text-xs text-ink-3">
          Account protection and where your data physically lives.
        </p>
      </header>

      <Card
        title="Two-factor authentication"
        description="Add a second factor to protect sign-ins."
      >
        <div className="flex items-center justify-between gap-4 rounded-md border border-line-softer bg-fill px-4 py-3">
          <div>
            <div className="text-sm font-medium">2FA is not enabled</div>
            <div className="mt-0.5 text-xs text-ink-3">
              Authenticator app and hardware key support is rolling out shortly.
            </div>
          </div>
          <button
            type="button"
            disabled
            className="rounded-md border border-line-soft bg-paper px-3 py-1.5 text-xs text-ink-3"
          >
            Enroll (coming soon)
          </button>
        </div>
      </Card>

      <form action={updateSecurityAction}>
        <fieldset disabled={!isAdmin} className="contents">
          <Card
            title="Data residency"
            description="Region in which conversation data and embeddings are stored. Admin only."
          >
            <Field label="Region">
              <SelectInput
                name="dataRegion"
                defaultValue={workspace?.dataRegion ?? 'us'}
                options={REGIONS}
              />
            </Field>
          </Card>

          {isAdmin ? (
            <div className="flex justify-end">
              <SubmitButton>Update region</SubmitButton>
            </div>
          ) : null}
        </fieldset>
      </form>
    </>
  );
}
