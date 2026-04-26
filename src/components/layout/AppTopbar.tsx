import Link from 'next/link';
import { signOutAction } from '@/app/(console)/sign-out';
import { ProfileMenu } from '@/components/layout/ProfileMenu';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { auth } from '@/server/auth/config';

export async function AppTopbar({ title }: { title?: string }) {
  const session = await auth();
  const email = session?.user?.email ?? '';
  const name = session?.user?.name ?? email.split('@')[0] ?? 'Account';
  return (
    <header className="flex h-14 items-center justify-between border-b border-line-soft bg-paper px-6">
      <h1 className="text-base font-semibold">{title}</h1>
      <div className="flex items-center gap-3 text-sm text-ink-3">
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-md border border-line-soft px-3 py-1.5 hover:bg-fill"
          >
            Sign out
          </button>
        </form>
        <ThemeToggle />
        <Link href="/agents/new" className="rounded-md bg-accent px-3 py-1.5 text-paper">
          + New agent
        </Link>
        <span className="mx-1 h-4 w-px bg-line-softer" />
        <ProfileMenu name={name} email={email} signOutAction={signOutAction} />
      </div>
    </header>
  );
}
