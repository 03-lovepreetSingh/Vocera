'use client';

import { Check } from '@/components/icons';
import type { LanguageDef } from '@/lib/languages';

interface Props {
  languages: readonly LanguageDef[];
  picked: string[];
  onChange: (codes: string[]) => void;
}

export function LanguagePicker({ languages, picked, onChange }: Props) {
  function toggle(code: string) {
    const next = picked.includes(code) ? picked.filter((c) => c !== code) : [...picked, code];
    if (next.length === 0) return; // require at least one
    onChange(next);
  }

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
      {languages.map((l) => {
        const active = picked.includes(l.code);
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => toggle(l.code)}
            className={`flex items-center justify-between rounded-md border px-2.5 py-2 text-left text-sm transition ${
              active
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line-soft bg-paper hover:bg-fill'
            }`}
          >
            <div>
              <div className="text-xs font-medium leading-tight">{l.label}</div>
              <div className="text-[10px] leading-tight text-ink-3">{l.native}</div>
            </div>
            {active && <Check className="h-3.5 w-3.5" />}
          </button>
        );
      })}
    </div>
  );
}
