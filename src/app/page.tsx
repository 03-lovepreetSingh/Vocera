import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="min-h-dvh">
      <header className="flex items-center justify-between px-8 py-5">
        <div className="font-mono text-lg font-semibold tracking-tight">Vocera</div>
        <nav className="flex items-center gap-4 text-sm text-ink-3">
          <Link href="/login" className="hover:text-ink">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-accent px-4 py-2 text-paper hover:opacity-90"
          >
            Get started
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-8 pt-24 pb-16 text-center">
        <h1 className="text-balance text-5xl font-semibold tracking-tight">
          the phone line, rebuilt for AI.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-ink-3">
          Build a voice or chat agent grounded in your own knowledge in minutes.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-accent px-5 py-3 font-medium text-paper hover:opacity-90"
          >
            Get started — it's free
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-line-soft px-5 py-3 font-medium hover:bg-paper"
          >
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
