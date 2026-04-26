/**
 * Workspace tab — admin-only mutations to the tenant boundary.
 *
 * Region + slug live on the workspaces row; voice/language defaults are
 * captured for forward-compat (the UI already needs them) but the schema
 * doesn't carry per-workspace defaults yet, so they round-trip but no-op.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { workspaces } from '@/db/schema';
import { auth } from '@/server/auth/config';
import { LANGUAGES } from '@/lib/languages';
import { updateWorkspaceAction } from '../actions';
import { Card, Field, SelectInput, SubmitButton, TextInput } from '../fields';

const REGIONS = [
  { value: 'us', label: 'United States (us-east-1)' },
  { value: 'eu', label: 'European Union (eu-west-1)' },
  { value: 'in', label: 'India (ap-south-1)' },
];

const VOICE_OPTIONS = [
  { value: 'rachel', label: 'Rachel — neutral US English' },
  { value: 'bella', label: 'Bella — warm, multilingual' },
  { value: 'antoni', label: 'Antoni — male, multilingual' },
  { value: 'arnold', label: 'Arnold — deep, authoritative' },
  { value: 'adam', label: 'Adam — male, narration' },
];

export default async function WorkspaceSettingsPage() {
  const session = await auth();
  const wsId = session?.user?.workspaceId;
  const isAdmin = session?.user?.role === 'admin';

  const workspace = wsId
    ? (
        await db
          .select({
            name: workspaces.name,
            slug: workspaces.slug,
            dataRegion: workspaces.dataRegion,
            plan: workspaces.plan,
          })
          .from(workspaces)
          .where(eq(workspaces.id, wsId))
          .limit(1)
      )[0]
    : null;

  return (
    <>
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Workspace</h1>
        <p className="mt-1 text-xs text-ink-3">
          Tenant-wide settings shared by everyone in this workspace.
        </p>
      </header>

      {!isAdmin ? (
        <div className="mb-4 rounded-md border border-line-soft bg-fill px-4 py-3 text-xs text-ink-3">
          You're signed in as <span className="font-medium">{session?.user?.role ?? 'member'}</span>.
          Only admins can change these settings.
        </div>
      ) : null}

      <form action={updateWorkspaceAction}>
        <fieldset disabled={!isAdmin} className="contents">
          <Card title="Identity">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Workspace name">
                <TextInput name="name" defaultValue={workspace?.name ?? ''} required />
              </Field>
              <Field label="URL slug" hint="Lowercase letters, numbers, dashes only.">
                <TextInput name="slug" defaultValue={workspace?.slug ?? ''} required />
              </Field>
            </div>
          </Card>

          <Card
            title="Defaults"
            description="Used as starting values when creating new agents."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Default voice">
                <SelectInput name="defaultVoice" defaultValue="rachel" options={VOICE_OPTIONS} />
              </Field>
              <Field label="Default language">
                <SelectInput
                  name="defaultLanguage"
                  defaultValue="en-US"
                  options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
                />
              </Field>
            </div>
          </Card>

          <Card
            title="Data residency"
            description="Where your conversations, transcripts, and embeddings are stored."
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
              <SubmitButton>Save workspace</SubmitButton>
            </div>
          ) : null}
        </fieldset>
      </form>
    </>
  );
}
