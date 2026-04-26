/**
 * Shared form primitives for the Settings sub-pages.
 *
 * These are deliberately plain server-renderable elements styled with the
 * design tokens (paper / fill / line-soft / accent). The form pages themselves
 * stay declarative — each sub-page is a server component that renders these
 * fields and posts to a server action.
 */

import { cn } from '@/lib/utils';

export function Card({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'mb-4 rounded-lg border border-line-soft bg-paper px-6 py-5 shadow-token-sm',
        className,
      )}
    >
      <header className="mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-3">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  name,
  defaultValue,
  placeholder,
  type = 'text',
  readOnly,
  required,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: 'text' | 'email' | 'url';
  readOnly?: boolean;
  required?: boolean;
}) {
  return (
    <input
      name={name}
      type={type}
      defaultValue={defaultValue}
      placeholder={placeholder}
      readOnly={readOnly}
      required={required}
      className={cn(
        'block w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm',
        'placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
        readOnly && 'cursor-not-allowed bg-fill text-ink-3',
      )}
    />
  );
}

export function SelectInput({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className="block w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper shadow-token-sm transition hover:opacity-90"
    >
      {children}
    </button>
  );
}

/**
 * Toggle row — checkbox styled to look like a switch label-row, matching the
 * v2 design canvas. The native <input type="checkbox"> stays accessible.
 */
export function ToggleRow({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center justify-between border-t border-line-softer py-3 first:border-t-0">
      <span>
        <span className="block text-sm">{label}</span>
        {hint ? <span className="block text-xs text-ink-3">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-line-soft text-accent focus:ring-accent"
      />
    </label>
  );
}
