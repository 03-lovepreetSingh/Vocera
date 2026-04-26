'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional leading icon node. */
  leading?: ReactNode;
  /** Optional trailing icon node. */
  trailing?: ReactNode;
  /** Make the button take full width. */
  block?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ' +
  'focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-50';

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
};

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-paper hover:bg-[color:color-mix(in_srgb,var(--accent)_88%,black)] border border-accent',
  secondary:
    'bg-paper text-ink border border-line-soft hover:bg-fill',
  ghost:
    'bg-transparent text-ink-2 hover:bg-fill border border-transparent',
  danger:
    'bg-err text-paper border border-err hover:bg-[color:color-mix(in_srgb,var(--err)_88%,black)]',
};

/**
 * Button — primary action element.
 * Uses design tokens (bg-accent, bg-paper, border-line-soft, etc.).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    leading,
    trailing,
    block = false,
    className,
    type,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        base,
        sizes[size],
        variants[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {leading ? <span className="inline-flex shrink-0">{leading}</span> : null}
      {children}
      {trailing ? <span className="inline-flex shrink-0">{trailing}</span> : null}
    </button>
  );
});

export default Button;
