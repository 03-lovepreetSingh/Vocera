'use client';

import { useState, useTransition } from 'react';
import { LanguagePicker } from './LanguagePicker';
import type { LanguageDef } from '@/lib/languages';
import type { CreateAgentResult } from '@/app/(console)/agents/new/actions';

const PURPOSES = [
  { id: 'support', label: 'Customer support', desc: 'Answer questions from your knowledge.' },
  { id: 'lead-qual', label: 'Lead qualification', desc: 'Capture leads conversationally.' },
  { id: 'booking', label: 'Appointment booking', desc: 'Schedule meetings.' },
  { id: 'ivr', label: 'Inbound IVR', desc: 'Replace press-1-for-billing menus.' },
  { id: 'outbound', label: 'Outbound calling', desc: 'Reach out to a list.' },
  { id: 'custom', label: 'Custom', desc: 'Bring your own prompt.' },
] as const;

interface Props {
  languages: readonly LanguageDef[];
  action: (input: {
    name: string;
    purpose: 'support' | 'lead-qual' | 'booking' | 'ivr' | 'outbound' | 'custom';
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
  const [purpose, setPurpose] =
    useState<(typeof PURPOSES)[number]['id']>('support');
  const [industry, setIndustry] = useState('');
  const [audience, setAudience] = useState('');
  const [description, setDescription] = useState('');
  const [freeText, setFreeText] = useState('');
  const [pickedLangs, setPickedLangs] = useState<string[]>(['en-US']);
  const [defaultLang, setDefaultLang] = useState('en-US');
  const [autoDetect, setAutoDetect] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
      <div className="mt-6 rounded-lg border border-line-soft bg-paper p-6">
        {step === 1 && (
          <div className="grid gap-5">
            <Field label="Agent name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Northwind Support"
                className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 outline-none focus:border-accent"
              />
            </Field>

            <Field label="Purpose">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {PURPOSES.map((p) => {
                  const active = purpose === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPurpose(p.id)}
                      className={`rounded-md border px-3 py-3 text-left text-sm transition ${
                        active
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line-soft bg-paper hover:bg-fill'
                      }`}
                    >
                      <div className="font-medium">{p.label}</div>
                      <div className="text-xs text-ink-3">{p.desc}</div>
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
                  className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 outline-none focus:border-accent"
                />
              </Field>
              <Field label="Audience (optional)">
                <input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="Existing customers"
                  className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 outline-none focus:border-accent"
                />
              </Field>
            </div>

            <Field label="About the business (optional)">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 outline-none focus:border-accent"
                placeholder="One paragraph the agent should know about you."
              />
            </Field>

            <Field label="Refinement notes (optional, 500 chars)">
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value.slice(0, 500))}
                rows={3}
                className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 outline-none focus:border-accent"
                placeholder="Things to do or avoid…"
              />
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
                <div className="mt-3 flex items-center gap-3 text-sm">
                  <span className="text-ink-3">Default:</span>
                  <select
                    value={defaultLang}
                    onChange={(e) => setDefaultLang(e.target.value)}
                    className="rounded-md border border-line-soft bg-paper px-2 py-1"
                  >
                    {pickedLangs.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <label className="ml-4 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={autoDetect}
                      onChange={(e) => setAutoDetect(e.target.checked)}
                    />
                    <span className="text-ink-3">Auto-detect from caller</span>
                  </label>
                </div>
              )}
            </Field>
          </div>
        )}

        {step === 2 && (
          <div>
            <h3 className="text-base font-semibold">Knowledge base</h3>
            <p className="mt-1 text-sm text-ink-3">
              You can upload knowledge after creating the agent — drag PDFs / DOCX / MD / TXT into
              the agent detail page. Skip for now.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-3">
            <h3 className="text-base font-semibold">Review</h3>
            <Pair k="Name" v={name} />
            <Pair k="Purpose" v={purpose} />
            {industry && <Pair k="Industry" v={industry} />}
            {audience && <Pair k="Audience" v={audience} />}
            <Pair k="Languages" v={pickedLangs.join(', ')} />
            <Pair k="Default language" v={defaultLang} />
            <Pair k="Auto-detect language" v={autoDetect ? 'on' : 'off'} />
            {description && <Pair k="About" v={description} />}
            {freeText && <Pair k="Notes" v={freeText} />}
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

        <div className="mt-6 flex justify-between">
          <button
            type="button"
            disabled={step === 1}
            onClick={back}
            className="rounded-md border border-line-soft px-4 py-2 text-sm disabled:opacity-50"
          >
            Back
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={next}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={submit}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
            >
              {isPending ? 'Creating…' : 'Create agent'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Steps({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-3 text-xs">
      {['Purpose & basics', 'Knowledge', 'Review'].map((label, i) => {
        const n = i + 1;
        const active = current === n;
        const done = current > n;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ${
                active
                  ? 'bg-accent text-paper'
                  : done
                    ? 'bg-accent-soft text-accent'
                    : 'bg-fill text-ink-3'
              }`}
            >
              {n}
            </span>
            <span className={active ? 'text-ink' : 'text-ink-3'}>{label}</span>
            {n < 3 && <span className="mx-1 h-px w-6 bg-line-soft" />}
          </li>
        );
      })}
    </ol>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      {children}
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 border-b border-line-soft py-2 text-sm">
      <span className="text-ink-3">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
