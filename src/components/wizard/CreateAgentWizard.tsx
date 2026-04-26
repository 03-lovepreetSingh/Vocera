'use client';

import { useMemo, useState, useTransition } from 'react';
import { LanguagePicker } from './LanguagePicker';
import type { LanguageDef } from '@/lib/languages';
import type { CreateAgentResult } from '@/app/(console)/agents/new/actions';
import { buildSystemPrompt } from '@/server/prompts';
import { Check } from '@/components/icons';

type PurposeId = 'support' | 'lead-qual' | 'booking' | 'ivr' | 'outbound' | 'custom';

interface PurposeDef {
  id: PurposeId;
  label: string;
  desc: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

// ── Purpose card icons (inline SVG, match the project's icons.tsx style) ──
function svg(...paths: React.ReactNode[]) {
  return (props: React.SVGProps<SVGSVGElement>) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths}
    </svg>
  );
}

const IconBook = svg(
  <path key="a" d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5z" />,
  <path key="b" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />,
);
const IconUser = svg(
  <circle key="a" cx="12" cy="8" r="4" />,
  <path key="b" d="M4 21a8 8 0 0 1 16 0" />,
);
const IconClock = svg(
  <circle key="a" cx="12" cy="12" r="9" />,
  <path key="b" d="M12 7v5l3 2" />,
);
const IconPhone = svg(
  <path
    key="a"
    d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"
  />,
);
const IconBolt = svg(<path key="a" d="M13 2 3 14h7l-1 8 10-12h-7z" />);
const IconTool = svg(
  <path
    key="a"
    d="M14.7 6.3a4 4 0 1 1 5 5l-9.3 9.3-5 1 1-5z"
  />,
);
const IconUpload = svg(
  <path key="a" d="M12 16V4" />,
  <path key="b" d="m6 10 6-6 6 6" />,
  <path key="c" d="M4 20h16" />,
);
const IconFile = svg(
  <path key="a" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />,
  <path key="b" d="M14 2v6h6" />,
);
const IconGlobe = svg(
  <circle key="a" cx="12" cy="12" r="9" />,
  <path key="b" d="M3 12h18" />,
  <path key="c" d="M12 3a14 14 0 0 1 0 18" />,
  <path key="d" d="M12 3a14 14 0 0 0 0 18" />,
);
const IconClose = svg(<path key="a" d="M18 6 6 18" />, <path key="b" d="m6 6 12 12" />);

const PURPOSES: readonly PurposeDef[] = [
  { id: 'support', label: 'Customer support', desc: 'Triage, FAQs, ticketing.', icon: IconBook },
  { id: 'lead-qual', label: 'Lead qualification', desc: 'Capture, score, route.', icon: IconUser },
  { id: 'booking', label: 'Appointment booking', desc: 'Calendar + confirmations.', icon: IconClock },
  { id: 'ivr', label: 'Inbound IVR', desc: 'Replace press-1 trees.', icon: IconPhone },
  { id: 'outbound', label: 'Outbound calling', desc: 'Reminders and follow-ups.', icon: IconBolt },
  { id: 'custom', label: 'Custom', desc: 'Bring your own prompt.', icon: IconTool },
] as const;

const PURPOSE_LABELS: Record<PurposeId, string> = PURPOSES.reduce(
  (acc, p) => {
    acc[p.id] = p.label;
    return acc;
  },
  {} as Record<PurposeId, string>,
);

const STEPS = [
  { n: 1, t: 'Purpose & basics' },
  { n: 2, t: 'Knowledge' },
  { n: 3, t: 'Review' },
] as const;

interface FakeFile {
  id: string;
  name: string;
  size: string;
  status: 'indexing' | 'indexed';
  progress: number;
}

interface Props {
  languages: readonly LanguageDef[];
  action: (input: {
    name: string;
    purpose: PurposeId;
    industry: string;
    audience: string;
    description: string;
    freeText: string;
    languages: string[];
    defaultLanguage: string;
    autoDetectLanguage: boolean;
  }) => Promise<CreateAgentResult>;
}

export function CreateAgentWizard({ languages, action }: Props) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<PurposeId>('support');
  const [industry, setIndustry] = useState('');
  const [audience, setAudience] = useState('');
  const [description, setDescription] = useState('');
  const [freeText, setFreeText] = useState('');
  const [pickedLangs, setPickedLangs] = useState<string[]>(['en-US']);
  const [defaultLang, setDefaultLang] = useState('en-US');
  const [autoDetect, setAutoDetect] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Local file list — UI only. Real upload lives on the agent detail page.
  const [files, setFiles] = useState<FakeFile[]>([]);

  // Generated starter prompt — editable in step 3.
  const generatedPrompt = useMemo(
    () =>
      buildSystemPrompt({
        purpose,
        industry: industry.trim() || null,
        audience: audience.trim() || null,
        description: description.trim() || null,
        freeText: freeText.trim() || null,
        languages: pickedLangs,
        defaultLanguage: pickedLangs.includes(defaultLang) ? defaultLang : pickedLangs[0] ?? 'en-US',
      }),
    [purpose, industry, audience, description, freeText, pickedLangs, defaultLang],
  );
  const [editedPrompt, setEditedPrompt] = useState<string | null>(null);
  const promptValue = editedPrompt ?? generatedPrompt;

  function next() {
    setError(null);
    if (step === 1) {
      if (!name.trim()) return setError('Name is required.');
      if (pickedLangs.length === 0) return setError('Pick at least one language.');
    }
    setStep((s) => Math.min(3, s + 1));
  }
  function back() {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  function onFilesPicked(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const additions: FakeFile[] = Array.from(picked).map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      name: f.name,
      size: prettySize(f.size),
      status: 'indexing',
      progress: 8,
    }));
    setFiles((prev) => [...prev, ...additions]);
    // Fake "indexing → indexed" so the UI feels alive without real work.
    additions.forEach((entry) => simulateIndexing(entry.id, setFiles));
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await action({
        name: name.trim(),
        purpose,
        industry: industry.trim(),
        audience: audience.trim(),
        description: description.trim(),
        freeText: freeText.trim(),
        languages: pickedLangs,
        defaultLanguage: pickedLangs.includes(defaultLang) ? defaultLang : pickedLangs[0],
        autoDetectLanguage: autoDetect,
      });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Steps current={step} />

      <div className="mt-6 rounded-lg border border-line-soft bg-paper p-6 shadow-token-sm">
        {step === 1 && (
          <div className="grid gap-5">
            <div>
              <h2 className="text-base font-semibold">What's this agent for?</h2>
              <p className="mt-1 text-sm text-ink-3">
                We'll tailor the starter prompt and defaults from your answers.
              </p>
            </div>

            <Field label="Agent name" hint="Shown across the app">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Northwind Support"
                className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm outline-none transition focus:border-accent"
              />
            </Field>

            <Field label="Primary purpose">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {PURPOSES.map((p) => {
                  const active = purpose === p.id;
                  const Icon = p.icon;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPurpose(p.id)}
                      className={`flex flex-col items-start gap-2 rounded-md p-3 text-left transition ${
                        active
                          ? 'border-2 border-accent bg-accent-soft text-accent'
                          : 'border border-line-soft bg-paper hover:bg-fill'
                      }`}
                      // Compensate the extra 1px the active border adds, so cards don't shift
                      style={{ padding: active ? '11px' : '12px' }}
                    >
                      <Icon
                        className={`h-4 w-4 ${active ? 'text-accent' : 'text-ink-3'}`}
                        aria-hidden
                      />
                      <div>
                        <div className="text-[12.5px] font-semibold leading-tight">{p.label}</div>
                        <div className={`mt-0.5 text-[11px] leading-tight ${active ? 'text-accent' : 'text-ink-3'}`}>
                          {p.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Industry (optional)">
                <input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="Telecom, healthcare…"
                  className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </Field>
              <Field label="Audience (optional)">
                <input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="Existing customers"
                  className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </Field>
            </div>

            <Field label="About the business (optional)">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="One paragraph the agent should know about you."
              />
            </Field>

            <Field label="Refinement notes (optional)">
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value.slice(0, 500))}
                rows={3}
                className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="Things to do or avoid…"
              />
              <div className="mt-1 flex justify-end text-[11px] text-ink-3">
                {freeText.length} / 500
              </div>
            </Field>

            <Field label="Languages this agent speaks">
              <LanguagePicker
                languages={languages}
                picked={pickedLangs}
                onChange={(codes) => {
                  setPickedLangs(codes);
                  if (!codes.includes(defaultLang)) setDefaultLang(codes[0] ?? 'en-US');
                }}
              />
              {pickedLangs.length > 1 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-ink-3">Default:</span>
                    <select
                      value={defaultLang}
                      onChange={(e) => setDefaultLang(e.target.value)}
                      className="rounded-md border border-line-soft bg-paper px-2 py-1 text-sm"
                    >
                      {pickedLangs.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={autoDetect}
                      onChange={(e) => setAutoDetect(e.target.checked)}
                      className="h-4 w-4 rounded border-line-soft accent-[var(--accent)]"
                    />
                    <span className="text-ink-3">Auto-detect from caller</span>
                  </label>
                </div>
              )}
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <div>
              <h2 className="text-base font-semibold">Add knowledge</h2>
              <p className="mt-1 text-sm text-ink-3">
                Drop the docs your agent should ground its answers on. You can also add more later.
              </p>
            </div>

            <DropZone onFiles={onFilesPicked} />

            {files.length > 0 && (
              <div className="mt-1">
                <div className="mb-2 text-[12.5px] font-medium">
                  Uploaded files ({files.length})
                </div>
                <ul className="grid gap-1.5">
                  {files.map((f) => (
                    <li
                      key={f.id}
                      className="grid grid-cols-[32px_1fr_120px_88px_24px] items-center gap-3 rounded-md border border-line-soft bg-paper px-3 py-2 text-[12.5px]"
                    >
                      <div className="grid h-7 w-7 place-items-center rounded-md bg-fill text-ink-3">
                        <IconFile className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{f.name}</div>
                        <div className="text-[11px] text-ink-3">{f.size}</div>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-line-softer">
                        <div
                          className="h-full bg-accent transition-[width] duration-300"
                          style={{ width: `${f.progress}%` }}
                        />
                      </div>
                      <span
                        className={`rounded px-1.5 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide ${
                          f.status === 'indexed'
                            ? 'bg-accent-soft text-accent'
                            : 'bg-fill text-ink-3'
                        }`}
                      >
                        {f.status === 'indexed' ? 'indexed' : 'indexing…'}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(f.id)}
                        className="grid h-5 w-5 place-items-center rounded text-ink-4 transition hover:bg-fill hover:text-ink"
                        aria-label={`Remove ${f.name}`}
                      >
                        <IconClose className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-5">
            <div>
              <h2 className="text-base font-semibold">Ready to create</h2>
              <p className="mt-1 text-sm text-ink-3">
                Review the basics, tweak the starter prompt, then create the agent.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 rounded-md border border-line-soft bg-fill/40 p-4 text-[12.5px] sm:grid-cols-3">
              <SummaryCell k="Name" v={name || '—'} />
              <SummaryCell k="Purpose" v={PURPOSE_LABELS[purpose]} />
              <SummaryCell k="Industry" v={industry || '—'} />
              <SummaryCell k="Audience" v={audience || '—'} />
              <SummaryCell
                k="Languages"
                v={pickedLangs.length ? pickedLangs.join(', ') : '—'}
              />
              <SummaryCell k="Default lang" v={defaultLang || '—'} />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="text-[12.5px] font-medium">Generated starter prompt</div>
                {editedPrompt !== null && (
                  <button
                    type="button"
                    onClick={() => setEditedPrompt(null)}
                    className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                  >
                    Reset to generated
                  </button>
                )}
              </div>
              <textarea
                value={promptValue}
                onChange={(e) => setEditedPrompt(e.target.value)}
                rows={10}
                spellCheck={false}
                className="w-full rounded-md border border-line-soft bg-fill/60 p-3 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus:border-accent"
              />
              <p className="mt-1 text-[11px] text-ink-3">
                You can refine this anytime from the agent's detail page. The server rebuilds the
                final prompt on submit from the structured fields above.
              </p>
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-err">{error}</p>}

        <div className="mt-6 flex justify-between">
          <button
            type="button"
            disabled={step === 1}
            onClick={back}
            className="rounded-md border border-line-soft px-4 py-2 text-sm transition hover:bg-fill disabled:opacity-40"
          >
            Back
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={next}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={submit}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2 text-sm font-semibold text-paper transition hover:opacity-90 disabled:opacity-60"
            >
              <IconBolt className="h-3.5 w-3.5" />
              {isPending ? 'Creating…' : 'Create agent'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── helpers ─────────────────────────

function simulateIndexing(
  id: string,
  setFiles: React.Dispatch<React.SetStateAction<FakeFile[]>>,
) {
  let p = 8;
  const tick = () => {
    p = Math.min(100, p + 12 + Math.random() * 14);
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id
          ? {
              ...f,
              progress: Math.round(p),
              status: p >= 100 ? 'indexed' : 'indexing',
            }
          : f,
      ),
    );
    if (p < 100) setTimeout(tick, 220 + Math.random() * 180);
  };
  setTimeout(tick, 250);
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ───────────────────────── subcomponents ─────────────────────────

function Steps({ current }: { current: number }) {
  return (
    <ol className="flex items-center">
      {STEPS.map((s, i) => {
        const isActive = current === s.n;
        const isDone = current > s.n;
        const last = i === STEPS.length - 1;
        return (
          <li key={s.n} className="flex flex-1 items-center">
            <div className="flex items-center gap-2.5">
              <span
                className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold transition ${
                  isDone
                    ? 'bg-accent text-paper'
                    : isActive
                      ? 'bg-ink text-paper ring-4 ring-accent/15'
                      : 'border border-line-soft bg-paper text-ink-3'
                }`}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : s.n}
              </span>
              <span
                className={`text-[12.5px] ${
                  isActive ? 'font-semibold text-ink' : isDone ? 'text-ink' : 'text-ink-3'
                }`}
              >
                {s.t}
              </span>
            </div>
            {!last && (
              <span
                className={`mx-3 h-px flex-1 transition ${
                  isDone ? 'bg-accent' : 'bg-line-softer'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</span>
        {hint && <span className="text-[10.5px] text-ink-4">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SummaryCell({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-wide text-ink-3">{k}</div>
      <div className="mt-0.5 truncate text-[13px] font-medium text-ink">{v}</div>
    </div>
  );
}

function DropZone({ onFiles }: { onFiles: (f: FileList | null) => void }) {
  const [hover, setHover] = useState(false);
  const [tab, setTab] = useState<'browse' | 'url' | 'notion'>('browse');

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        onFiles(e.dataTransfer.files);
      }}
      className={`rounded-lg border-2 border-dashed p-8 text-center transition ${
        hover ? 'border-accent bg-accent-soft/40' : 'border-line-soft bg-fill/40'
      }`}
    >
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-md bg-accent-soft text-accent">
        <IconUpload className="h-5 w-5" />
      </div>
      <div className="mt-3 text-sm font-semibold">
        Drop a PDF, DOCX, MD, or TXT
      </div>
      <div className="mt-1 text-[11.5px] text-ink-3">
        Up to 100 MB each. We'll index it for retrieval.
      </div>

      {/* Method tabs */}
      <div className="mt-4 inline-flex rounded-md border border-line-soft bg-paper p-0.5 text-[11.5px]">
        <TabBtn active={tab === 'browse'} onClick={() => setTab('browse')}>
          <IconFile className="h-3 w-3" /> Browse
        </TabBtn>
        <TabBtn active={tab === 'url'} onClick={() => setTab('url')}>
          <IconGlobe className="h-3 w-3" /> URL crawler
        </TabBtn>
        <TabBtn active={tab === 'notion'} onClick={() => setTab('notion')}>
          <IconBook className="h-3 w-3" /> Notion
        </TabBtn>
      </div>

      <div className="mt-3">
        {tab === 'browse' && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-accent px-4 py-2 text-[12px] font-medium text-paper transition hover:opacity-90">
            <IconFile className="h-3.5 w-3.5" />
            Choose files
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.md,.txt"
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
        )}
        {tab === 'url' && (
          <div className="mx-auto flex max-w-md items-center gap-2">
            <input
              disabled
              placeholder="https://docs.example.com  (coming soon)"
              className="flex-1 rounded-md border border-line-soft bg-paper px-3 py-2 text-[12px] text-ink-3 outline-none"
            />
            <button
              disabled
              className="rounded-md border border-line-soft bg-paper px-3 py-2 text-[12px] text-ink-3"
            >
              Crawl
            </button>
          </div>
        )}
        {tab === 'notion' && (
          <div className="mx-auto flex max-w-md items-center gap-2">
            <input
              disabled
              placeholder="Notion workspace token  (coming soon)"
              className="flex-1 rounded-md border border-line-soft bg-paper px-3 py-2 text-[12px] text-ink-3 outline-none"
            />
            <button
              disabled
              className="rounded-md border border-line-soft bg-paper px-3 py-2 text-[12px] text-ink-3"
            >
              Connect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 transition ${
        active ? 'bg-accent text-paper' : 'text-ink-3 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
