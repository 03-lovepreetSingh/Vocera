import { AppTopbar } from '@/components/layout/AppTopbar';
import { auth } from '@/server/auth/config';

export default async function SettingsPage() {
  const session = await auth();
  return (
    <>
      <AppTopbar title="Settings" />
      <main className="flex-1 px-6 py-6">
        <div className="rounded-lg border border-line-soft bg-paper px-5 py-4 text-sm">
          <div className="mb-3 text-base font-semibold">Profile</div>
          <Pair k="Email" v={session?.user?.email ?? '—'} />
          <Pair k="Workspace" v={session?.user?.workspaceExternalId ?? '—'} />
          <Pair k="Role" v={session?.user?.role ?? '—'} />
        </div>
      </main>
    </>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 border-b border-line-soft py-2 text-sm last:border-b-0">
      <span className="text-ink-3">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
