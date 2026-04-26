'use client';

import { LanguagePicker } from '@/components/wizard/LanguagePicker';
import { LANGUAGES } from '@/lib/languages';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface InitialState {
  name: string;
  purpose: string;
  industry: string;
  audience: string;
  description: string;
  status: 'draft' | 'live';
  languages: string[];
  defaultLanguage: string;
  autoDetectLanguage: boolean;
}

interface Props {
  agentExternalId: string;
  initial: InitialState;
}

const PURPOSES = [
  { v: 'support', l: 'Support' },
  { v: 'lead-qual', l: 'Lead qualification' },
  { v: 'booking', l: 'Booking' },
  { v: 'ivr', l: 'IVR / phone tree' },
  { v: 'outbound', l: 'Outbound' },
  { v: 'custom', l: 'Custom' },
] as const;

/**
 * Editable form for an agent's Basic Info tab. Saves via PATCH; shows a small
 * "saved" toast and refreshes the route so server-rendered version chips
 * pick up any version bumps.
 */
export function BasicInfoForm({ agentExternalId, initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState<InitialState>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function patch<K extends keyof InitialState>(key: K, value: InitialState[K]) {
    setState((s) => ({ ...s, [key]: value }));
    setSaved(false);
  }

  async function onSave() {
    setError(null);
    setSaved(false);
    const payload = {
      name: state.name.trim(),
      purpose: state.purpose,
      industry: state.industry.trim() || null,
      audience: state.audience.trim() || null,
      description: state.description.trim() || null,
      status: state.status,
      languages: state.languages,
      defaultLanguage: state.defaultLanguage,
      autoDetectLanguage: state.autoDetectLanguage,
    };
    const res = await fetch(`/api/v1/agents/${agentExternalId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(typeof j?.error === 'string' ? j.error : 'Failed to save');
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  // Keep defaultLanguage in sync with picked languages.
  function setLanguages(codes: string[]) {
    setState((s) => ({
      ...s,
      languages: codes,
      defaultLanguage: codes.includes(s.defaultLanguage) ? s.defaultLanguage : codes[0],
    }));
    setSaved(false);
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Agent name">
          <input
            className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
            value={state.name}
            onChange={(e) => patch('name', e.target.value)}
            maxLength={80}
          />
        </Field>
        <Field label="Purpose">
          <select
            className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
            value={state.purpose}
            onChange={(e) => patch('purpose', e.target.value)}
          >
            {PURPOSES.map((p) => (
              <option key={p.v} value={p.v}>
                {p.l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Industry">
          <input
            className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
            value={state.industry}
            onChange={(e) => patch('industry', e.target.value)}
            maxLength={80}
            placeholder="e.g. Telecom"
          />
        </Field>
        <Field label="Audience">
          <input
            className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
            value={state.audience}
            onChange={(e) => patch('audience', e.target.value)}
            maxLength={80}
            placeholder="e.g. SMB owners"
          />
        </Field>
      </div>

      <Field
        label="Description"
        hint="A few sentences about the business — used to ground answers."
      >
        <textarea
          className="w-full resize-y rounded-md border border-line-soft bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
          rows={3}
          value={state.description}
          onChange={(e) => patch('description', e.target.value)}
          maxLength={2000}
        />
      </Field>

      <Field label="Languages" hint="Pick every language the agent should understand.">
        <LanguagePicker languages={LANGUAGES} picked={state.languages} onChange={setLanguages} />
      </Field>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Default language" hint="Used when no signal is available.">
          <select
            className="w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
            value={state.defaultLanguage}
            onChange={(e) => patch('defaultLanguage', e.target.value)}
          >
            {state.languages.map((c) => (
              <option key={c} value={c}>
                {LANGUAGES.find((l) => l.code === c)?.label ?? c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <div className="flex gap-2">
            {(['draft', 'live'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => patch('status', s)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize transition ${
                  state.status === s
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line-soft bg-paper hover:bg-fill'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.autoDetectLanguage}
          onChange={(e) => patch('autoDetectLanguage', e.target.checked)}
        />
        <span>Auto-detect caller language each turn</span>
      </label>

      <div className="flex items-center justify-between border-t border-line-softer pt-4">
        <div className="text-xs text-ink-3">
          {error ? <span className="text-red-500">{error}</span> : saved ? 'Saved.' : ' '}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setState(initial);
              setSaved(false);
              setError(null);
            }}
            className="rounded-md border border-line-soft bg-paper px-4 py-2 text-sm hover:bg-fill"
            disabled={pending}
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || state.name.trim().length === 0}
            className="rounded-md bg-accent px-4 py-2 text-sm text-paper disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
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
    <div className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-ink-2">{label}</span>
        {hint ? <span className="text-[11px] text-ink-3">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
