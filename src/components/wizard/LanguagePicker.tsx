'use client';

import { Check } from '@/components/icons';
import type { LanguageDef } from '@/lib/languages';

interface Props {
  languages: readonly LanguageDef[];
  picked: string[];
  onChange: (codes: string[]) => void;
}

/**
 * Multi-select language chips. At least one must stay picked.
 * Active chips get the accent treatment + a tiny check, matching the
 * purpose-card pattern in the Create-Agent wizard.
 */
export function LanguagePicker({ languages, picked, onChange }: Props) {
  function toggle(code: string) {
    const isPicked = picked.includes(code);
    // Block unpicking the last remaining language.
    if (isPicked && picked.length === 1) return;
    const next = isPicked ? picked.filter((c) => c !== code) : [...picked, code];
    onChange(next);
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
        {languages.map((l) => {
          const active = picked.includes(l.code);
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => toggle(l.code)}
              aria-pressed={active}
              className={`group flex items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition ${
                active
                  ? 'border-2 border-accent bg-accent-soft text-accent'
                  : 'border border-line-soft bg-paper hover:bg-fill'
              }`}
              // Compensate the extra 1px the active border adds, so chips don't shift.
              style={{ padding: active ? '7px 9px' : '8px 10px' }}
            >
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold leading-tight">{l.label}</div>
                <div
                  className={`truncate text-[10.5px] leading-tight ${
                    active ? 'text-accent/80' : 'text-ink-3'
                  }`}
                >
                  {l.native}
                </div>
              </div>
              <span
                className={`ml-2 grid h-4 w-4 shrink-0 place-items-center rounded-full transition ${
                  active
                    ? 'bg-accent text-paper'
                    : 'border border-line-soft text-transparent group-hover:border-ink-3'
                }`}
                aria-hidden
              >
                <Check className="h-2.5 w-2.5" />
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-ink-3">
        {picked.length} selected · click to add or remove
      </div>
    </div>
  );
}
