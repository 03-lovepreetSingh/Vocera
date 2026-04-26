'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visible label rendered above the field. */
  label?: ReactNode;
  /** Helper text rendered below the field. Hidden when `error` is set. */
  hint?: ReactNode;
  /** Error message — renders red border + error text below. */
  error?: ReactNode;
  /** Optional leading visual node (icon, prefix, etc.). */
  leading?: ReactNode;
  /** Optional trailing visual node (icon, kbd shortcut, etc.). */
  trailing?: ReactNode;
  /** Class applied to the outer wrapper (label + input + hint). */
  containerClassName?: string;
}

/**
 * Input — labeled text input with hint + error states.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    leading,
    trailing,
    id,
    className,
    containerClassName,
    type = 'text',
    disabled,
    required,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `input-${reactId}`;
  const describedById = hint || error ? `${inputId}-desc` : undefined;
  const hasError = Boolean(error);

  return (
    <div className={cn('flex flex-col gap-1', containerClassName)}>
      {label ? (
        <label
          htmlFor={inputId}
          className="text-xs font-medium text-ink-2"
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-err" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      <div
        className={cn(
          'flex items-center rounded-md border bg-paper transition-colors',
          'focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-1 focus-within:ring-offset-paper',
          hasError
            ? 'border-err focus-within:ring-err'
            : 'border-line-soft focus-within:border-accent',
          disabled && 'opacity-50',
        )}
      >
        {leading ? (
          <span className="pl-2.5 text-ink-3">{leading}</span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          type={type}
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedById}
          className={cn(
            'h-9 w-full rounded-md bg-transparent px-3 text-sm text-ink placeholder:text-ink-4',
            'focus:outline-none disabled:cursor-not-allowed',
            leading && 'pl-2',
            trailing && 'pr-2',
            className,
          )}
          {...rest}
        />
        {trailing ? (
          <span className="pr-2.5 text-ink-3">{trailing}</span>
        ) : null}
      </div>
      {hasError ? (
        <p id={describedById} className="text-xs text-err">
          {error}
        </p>
      ) : hint ? (
        <p id={describedById} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default Input;
