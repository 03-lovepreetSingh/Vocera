import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Sparkline } from './Sparkline';

export type StatDeltaTone = 'positive' | 'negative' | 'neutral';

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Small uppercase label above the value. */
  label: ReactNode;
  /** Primary stat value (already formatted). */
  value: ReactNode;
  /** Optional delta string e.g. "+12%". Tone is inferred from the leading sign unless `deltaTone` is provided. */
  delta?: string;
  /** Override tone for the delta badge. */
  deltaTone?: StatDeltaTone;
  /** Optional sparkline data. */
  sparkline?: number[];
  /** Optional helper/footnote text below the value. */
  hint?: ReactNode;
}

function inferTone(delta: string | undefined, override?: StatDeltaTone): StatDeltaTone {
  if (override) return override;
  if (!delta) return 'neutral';
  const trimmed = delta.trim();
  if (trimmed.startsWith('+')) return 'positive';
  if (trimmed.startsWith('-') || trimmed.startsWith('−')) return 'negative';
  return 'neutral';
}

const toneClass: Record<StatDeltaTone, string> = {
  positive: 'text-ok',
  negative: 'text-err',
  neutral: 'text-ink-3',
};

/**
 * StatCard — KPI card with label, value, optional delta and sparkline.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaTone,
  sparkline,
  hint,
  className,
  ...rest
}: StatCardProps) {
  const tone = inferTone(delta, deltaTone);
  return (
    <div
      {...rest}
      className={cn(
        'rounded-lg border border-line-soft bg-paper p-5 shadow-token-sm',
        className,
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold leading-none tracking-tight text-ink">
          {value}
        </div>
        {sparkline && sparkline.length > 0 ? (
          <Sparkline points={sparkline} className="-mb-0.5 shrink-0" />
        ) : null}
      </div>
      {(delta || hint) && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          {delta ? (
            <span className={cn('font-medium', toneClass[tone])}>{delta}</span>
          ) : (
            <span />
          )}
          {hint ? <span className="text-ink-3">{hint}</span> : null}
        </div>
      )}
    </div>
  );
}

export default StatCard;
