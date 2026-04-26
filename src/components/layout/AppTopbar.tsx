import Link from 'next/link';
import { signOutAction } from '@/app/(console)/sign-out';
import { auth } from '@/server/auth/config';

export async function AppTopbar({ title }: { title?: string }) {
  const session = await auth();
  const email = session?.user?.email ?? '';
  return (
    <header className="flex h-14 items-center justify-between border-b border-line-soft bg-paper px-6">
      <h1 className="text-base font-semibold">{title}</h1>
      <div className="flex items-center gap-3 text-sm text-ink-3">
        <span className="font-mono text-xs">{email}</span>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-md border border-line-soft px-3 py-1.5 hover:bg-fill"
          >
            Sign out
          </button>
        </form>
        <Link href="/agents/new" className="rounded-md bg-accent px-3 py-1.5 text-paper">
          + New agent
        </Link>
      </div>
    </header>
  );
}
