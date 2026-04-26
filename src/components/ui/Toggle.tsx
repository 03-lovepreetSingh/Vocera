'use client';

import { forwardRef, useCallback, useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ToggleProps {
  /** Visible label rendered next to the switch. */
  label?: ReactNode;
  /** Optional helper/description text. */
  description?: ReactNode;
  /** Controlled checked state. */
  checked?: boolean;
  /** Default checked for uncontrolled usage. */
  defaultChecked?: boolean;
  /** Called when the user toggles the switch. */
  onChange?: (checked: boolean) => void;
  /** Disable interaction. */
  disabled?: boolean;
  /** Place the label on the right (default) or left. */
  labelPosition?: 'left' | 'right';
  /** Switch size. */
  size?: 'sm' | 'md';
  /** Accessible label override (when `label` is omitted). */
  ariaLabel?: string;
  id?: string;
  className?: string;
  /** Optional name (for use inside forms — emits a hidden input). */
  name?: string;
  /** Value emitted on the hidden input when `checked`. Default 'on'. */
  value?: string;
}

const sizes = {
  sm: { track: 'h-4 w-7', thumb: 'h-3 w-3', translate: 'translate-x-3' },
  md: { track: 'h-5 w-9', thumb: 'h-4 w-4', translate: 'translate-x-4' },
} as const;

/**
 * Toggle — accessible switch component, supports controlled & uncontrolled use.
 */
export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  {
    label,
    description,
    checked,
    defaultChecked = false,
    onChange,
    disabled = false,
    labelPosition = 'right',
    size = 'md',
    ariaLabel,
    id,
    className,
    name,
    value = 'on',
  },
  ref,
) {
  const reactId = useId();
  const switchId = id ?? `toggle-${reactId}`;
  const isControlled = checked !== undefined;
  const [internal, setInternal] = useState<boolean>(defaultChecked);
  const isOn = isControlled ? Boolean(checked) : internal;
  const sz = sizes[size];

  const toggle = useCallback(() => {
    if (disabled) return;
    if (!isControlled) setInternal((prev) => !prev);
    onChange?.(!isOn);
  }, [disabled, isControlled, isOn, onChange]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  const labelEl = (label || description) && (
    <label
      htmlFor={switchId}
      className={cn(
        'flex flex-col gap-0.5 text-sm leading-tight',
        disabled ? 'cursor-not-allowed text-ink-3' : 'cursor-pointer text-ink',
      )}
    >
      {label ? <span className="font-medium">{label}</span> : null}
      {description ? (
        <span className="text-xs text-ink-3">{description}</span>
      ) : null}
    </label>
  );

  const switchEl = (
    <button
      ref={ref}
      id={switchId}
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={!label ? ariaLabel : undefined}
      disabled={disabled}
      onClick={toggle}
      onKeyDown={onKeyDown}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper',
        sz.track,
        isOn
          ? 'border-accent bg-accent'
          : 'border-line-soft bg-fill',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none inline-block translate-x-0.5 transform rounded-full bg-paper shadow-token-sm transition-transform duration-150 ease-out',
          sz.thumb,
          isOn && sz.translate,
        )}
      />
    </button>
  );

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2.5',
        labelPosition === 'left' && 'flex-row-reverse',
        className,
      )}
    >
      {switchEl}
      {labelEl}
      {name ? (
        <input
          type="hidden"
          name={name}
          value={isOn ? value : ''}
        />
      ) : null}
    </div>
  );
});

export default Toggle;
