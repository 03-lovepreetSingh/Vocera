import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant =
  | 'live'
  | 'draft'
  | 'archived'
  | 'warn'
  | 'ok'
  | 'err'
  | 'accent'
  | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Show a leading status dot. */
  dot?: boolean;
  children?: ReactNode;
}

const variantClass: Record<BadgeVariant, string> = {
  live: 'bg-accent-soft text-[color:var(--accent)] border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)]',
  ok: 'bg-[#dcfce7] text-[#14532d] border-[#bbf7d0] dark:bg-[#14532d33] dark:text-[#86efac] dark:border-[#14532d]',
  warn: 'bg-[#fef3c7] text-[#78350f] border-[#fde68a] dark:bg-[#78350f33] dark:text-[#fbbf24] dark:border-[#78350f]',
  err: 'bg-[#fee2e2] text-[#7f1d1d] border-[#fecaca] dark:bg-[#7f1d1d33] dark:text-[#fca5a5] dark:border-[#7f1d1d]',
  draft: 'bg-fill text-ink-2 border-line-softer',
  archived: 'bg-fill-2 text-ink-3 border-line-softer',
  accent: 'bg-accent-soft text-[color:var(--accent)] border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)]',
  neutral: 'bg-fill text-ink-2 border-line-softer',
};

const dotClass: Record<BadgeVariant, string> = {
  live: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  err: 'bg-err',
  draft: 'bg-ink-4',
  archived: 'bg-ink-4',
  accent: 'bg-accent',
  neutral: 'bg-ink-4',
};

/**
 * Badge — small pill chip with semantic color variants.
 */
export function Badge({
  variant = 'neutral',
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-none',
        variantClass[variant],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn('h-1.5 w-1.5 rounded-full', dotClass[variant])}
        />
      ) : null}
      {children}
    </span>
  );
}

export default Badge;
