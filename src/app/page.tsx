import Link from 'next/link';
import {
  Bot,
  Mic,
  Layers,
  Phone,
  BarChart3,
  Cog,
  Check,
} from '@/components/icons';

/* ------------------------------------------------------------------ */
/*  Local presentational primitives — kept inline so this page owns
    nothing outside src/app/page.tsx (per task contract).             */
/* ------------------------------------------------------------------ */

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={
        'inline-flex items-center gap-2 font-mono text-lg font-semibold tracking-tight ' +
        className
      }
    >
      <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-[13px] font-bold text-[#052525]">
        v
      </span>
      Vocera
    </span>
  );
}

/** Static SVG waveform stripe — purely decorative. */
function Waveform({
  bars = 56,
  className = '',
  barClassName = 'bg-accent',
}: {
  bars?: number;
  className?: string;
  barClassName?: string;
}) {
  // Deterministic pseudo-random heights so SSR ↔ client agree.
  const heights = Array.from({ length: bars }, (_, i) => {
    const seed = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const norm = Math.abs(seed);
    return 18 + Math.round(norm * 70); // 18% – 88%
  });
  return (
    <div
      aria-hidden
      className={'flex h-full items-center gap-[3px] ' + className}
    >
      {heights.map((h, i) => (
        <span
          key={i}
          className={'w-[3px] rounded-full ' + barClassName}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Static demo data                                                   */
/* ------------------------------------------------------------------ */

const TRANSCRIPT: { role: 'agent' | 'caller'; text: string }[] = [
  {
    role: 'agent',
    text: "Hi! This is Vee from Northwind Support. How can I help you today?",
  },
  {
    role: 'caller',
    text: 'Uh yeah, my router keeps rebooting every couple of hours.',
  },
  {
    role: 'agent',
    text: 'Got it. Can I grab your account number or the phone on file?',
  },
  { role: 'caller', text: '555-0142.' },
  {
    role: 'agent',
    text: 'Thanks — I see you on the Pro plan. Let me run a remote diagnostic…',
  },
];

const CONTEXT_CHIPS: { label: string; tag: string }[] = [
  { tag: 'KB', label: 'router-troubleshooting.md' },
  { tag: 'Tool', label: 'check-account-status' },
  { tag: 'CRM', label: 'Pro · 3 open tickets' },
  { tag: 'Intent', label: 'technical-issue' },
];

const CAPABILITIES: {
  Icon: (p: React.SVGProps<SVGSVGElement>) => JSX.Element;
  title: string;
  desc: string;
}[] = [
  {
    Icon: Bot,
    title: 'Agent builder',
    desc: 'Prompt, persona, guardrails — all in one place.',
  },
  {
    Icon: Mic,
    title: 'Natural voices',
    desc: '40+ languages with barge-in and emotion.',
  },
  {
    Icon: Layers,
    title: 'Knowledge base',
    desc: 'Drop PDFs, URLs, Notion. Grounded answers.',
  },
  {
    Icon: Phone,
    title: 'Telephony',
    desc: 'Twilio, Exotel, SIP, WebRTC — plug & dial.',
  },
  {
    Icon: BarChart3,
    title: 'Analytics',
    desc: 'Every call scored, transcribed, searchable.',
  },
  {
    Icon: Cog,
    title: 'Multilingual',
    desc: 'Auto-detect & switch language mid-call.',
  },
];

const STEPS: { n: string; title: string; desc: string }[] = [
  {
    n: '01',
    title: 'Drop your docs',
    desc: 'Upload PDFs, paste URLs, sync Notion. Grounded in seconds.',
  },
  {
    n: '02',
    title: 'Tune the prompt',
    desc: 'Pick a voice, set persona and guardrails, iterate live.',
  },
  {
    n: '03',
    title: 'Connect Twilio',
    desc: 'BYO number or provision fresh — calls route in one click.',
  },
];

const PRICING_FEATURES = [
  'Unlimited agents & numbers',
  'All telephony integrations',
  'Knowledge base + tool calls',
  'Real-time analytics & QA',
  'No seats, no minimums',
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function LandingPage() {
  return (
    <main className="min-h-dvh bg-paper text-ink">
      {/* =========================================================
          1.  DARK HERO  (nav lives inside the dark block)
         ========================================================= */}
      <section className="relative bg-[#0b0d10] text-white">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
          <Link href="/" aria-label="Vocera home">
            <Wordmark className="text-white" />
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="rounded-md px-4 py-2 text-sm text-white/80 transition hover:text-white"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-[#052525] transition hover:opacity-90"
            >
              Get started
            </Link>
          </nav>
        </header>

        <div className="mx-auto max-w-4xl px-6 pb-32 pt-10 text-center sm:px-8 sm:pb-40 sm:pt-16">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80">
            <span aria-hidden>🎙</span>
            introducing Vocera Voice v2 — 40% faster
          </span>

          <h1 className="mt-7 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
            the phone line,
            <br />
            <span className="text-accent">rebuilt for AI.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-base text-white/70 sm:text-lg">
            Design, deploy, and observe voice agents that answer 24/7. Built
            for IVR, support, and outbound at scale.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-medium text-[#052525] transition hover:opacity-90"
            >
              Get started — it&apos;s free
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 bg-transparent px-5 py-3 text-sm font-medium text-white transition hover:bg-white/5"
            >
              <span aria-hidden>📞</span>
              Call a demo agent
            </Link>
          </div>
        </div>
      </section>

      {/* =========================================================
          2.  LIVE TRANSCRIPT CARD (overlaps the hero)
         ========================================================= */}
      <section
        aria-label="Live call demo"
        className="relative z-10 -mt-24 px-6 sm:-mt-28 sm:px-8"
      >
        <div className="mx-auto max-w-5xl rounded-2xl border border-line-soft bg-paper p-5 shadow-2xl shadow-black/20 sm:p-7">
          {/* card header */}
          <div className="flex flex-col gap-2 border-b border-dashed border-line-soft pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              <span className="font-mono text-sm font-semibold text-ink">
                LIVE
              </span>
              <span className="text-sm text-ink-3">
                inbound from{' '}
                <span className="font-mono text-ink">+1 415 555 0142</span>
              </span>
            </div>
            <div className="text-xs text-ink-3 sm:text-sm">
              <span className="font-mono">00:47</span> · en-US ·{' '}
              <span className="text-ink">Vee from Northwind</span>
            </div>
          </div>

          {/* card body */}
          <div className="grid gap-6 pt-5 md:grid-cols-[1fr_280px]">
            {/* transcript column */}
            <div>
              <ol className="space-y-4">
                {TRANSCRIPT.map((m, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className={
                        'mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full font-mono text-xs font-bold ' +
                        (m.role === 'agent'
                          ? 'bg-accent text-[#052525]'
                          : 'bg-fill text-ink')
                      }
                    >
                      {m.role === 'agent' ? 'V' : 'C'}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-wider text-ink-3">
                        {m.role === 'agent' ? 'Agent' : 'Caller'}
                      </div>
                      <p className="text-sm leading-relaxed text-ink">
                        {m.text}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              {/* live waveform stripe */}
              <div className="mt-5 flex items-center gap-3 rounded-lg border border-line-soft bg-fill px-3 py-2">
                <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-accent text-[#052525]">
                  <Mic className="h-3.5 w-3.5" />
                </span>
                <div className="h-6 flex-1">
                  <Waveform bars={64} />
                </div>
                <span className="font-mono text-xs text-ink-3">
                  speaking…
                </span>
              </div>
            </div>

            {/* live context rail */}
            <aside className="rounded-xl border border-line-soft bg-fill p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">
                Live context
              </div>
              <ul className="mt-3 space-y-2">
                {CONTEXT_CHIPS.map((c) => (
                  <li
                    key={c.tag}
                    className="flex items-center gap-2 rounded-md border border-line-soft bg-paper px-2.5 py-1.5 text-xs"
                  >
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink">
                      {c.tag}
                    </span>
                    <span className="truncate text-ink">{c.label}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                <div className="text-[11px] uppercase tracking-wider text-ink-3">
                  Sentiment
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div
                    aria-hidden
                    className="h-1.5 flex-1 rounded-full"
                    style={{
                      background:
                        'linear-gradient(90deg, #ef4444 0%, #f59e0b 55%, #10b981 100%)',
                    }}
                  />
                  <span className="font-mono text-[11px] text-ink-3">
                    neutral
                  </span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* =========================================================
          3.  CAPABILITIES — bento
         ========================================================= */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-24 sm:px-8 sm:pt-28">
        <div className="mb-10 flex flex-col items-start gap-3">
          <span className="rounded-full border border-line-soft bg-fill px-3 py-1 text-xs text-ink-3">
            Capabilities
          </span>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            A complete voice agent stack.
          </h2>
        </div>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ Icon, title, desc }, i) => (
            <li
              key={title}
              className={
                'rounded-xl border border-line-soft bg-paper p-5 transition hover:border-ink-3/40 ' +
                (i === 1 ? 'bg-accent-soft' : '')
              }
            >
              <span className="grid h-9 w-9 place-items-center rounded-md bg-fill text-ink">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold tracking-tight">
                {title}
              </h3>
              <p className="mt-1 text-sm text-ink-3">{desc}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* =========================================================
          4.  HOW IT WORKS
         ========================================================= */}
      <section className="bg-fill py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-6 sm:px-8">
          <div className="mb-10 flex flex-col items-start gap-3">
            <span className="rounded-full border border-line-soft bg-paper px-3 py-1 text-xs text-ink-3">
              How it works
            </span>
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Three steps to a live phone number.
            </h2>
          </div>

          <ol className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <li
                key={s.n}
                className="rounded-xl border border-line-soft bg-paper p-6"
              >
                <div className="font-mono text-sm font-semibold text-accent">
                  {s.n}
                </div>
                <h3 className="mt-3 text-xl font-semibold tracking-tight">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm text-ink-3">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* =========================================================
          5.  PRICING
         ========================================================= */}
      <section
        aria-labelledby="pricing-title"
        className="mx-auto max-w-3xl px-6 py-20 sm:px-8 sm:py-24"
      >
        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          <span className="rounded-full border border-line-soft bg-fill px-3 py-1 text-xs text-ink-3">
            Pricing
          </span>
          <h2
            id="pricing-title"
            className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Pay per minute. No seats.
          </h2>
        </div>

        <article className="rounded-2xl border border-line-soft bg-paper p-7 shadow-sm sm:p-9">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold tracking-tight">
              Pay as you go
            </h3>
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-ink">
              most flexible
            </span>
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-5xl font-semibold tracking-tight sm:text-6xl">
              $0.09
            </span>
            <span className="text-sm text-ink-3">/ minute</span>
          </div>
          <p className="mt-2 text-sm text-ink-3">
            <span className="font-medium text-ink">100 minutes free</span>{' '}
            every month. No credit card required.
          </p>

          <hr className="my-6 border-dashed border-line-soft" />

          <ul className="space-y-2.5">
            {PRICING_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 flex-shrink-0 text-accent" />
                <span className="text-ink">{f}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/signup"
            className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-medium text-[#052525] transition hover:opacity-90"
          >
            Start free
            <span aria-hidden>→</span>
          </Link>
        </article>
      </section>

      {/* =========================================================
          6.  FOOTER
         ========================================================= */}
      <footer className="border-t border-line-soft bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-10 sm:flex-row sm:items-center sm:px-8">
          <Wordmark />
          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-3">
              {[
                { label: 'Docs', href: '#' },
                { label: 'Blog', href: '#' },
                { label: 'Privacy', href: '#' },
                { label: 'Terms', href: '#' },
                { label: 'Twitter', href: '#' },
                { label: 'GitHub', href: '#' },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="transition hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mx-auto max-w-6xl border-t border-line-soft px-6 py-5 text-xs text-ink-3 sm:px-8">
          © {new Date().getFullYear()} Vocera. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
