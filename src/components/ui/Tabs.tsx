import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  href: string;
  label: ReactNode;
  active?: boolean;
  /** Optional small badge/count rendered after the label. */
  badge?: ReactNode;
  /** Disable navigation styling and click. */
  disabled?: boolean;
}

export type TabsOrientation = 'horizontal' | 'vertical';

export interface TabsProps {
  items: TabItem[];
  orientation?: TabsOrientation;
  className?: string;
  /** ARIA label for the navigation landmark. */
  ariaLabel?: string;
}

/**
 * Tabs — simple navigational tab list using next/link.
 * Stateless: callers pass `active: true` on the matching item.
 */
export function Tabs({
  items,
  orientation = 'horizontal',
  className,
  ariaLabel,
}: TabsProps) {
  const isHorizontal = orientation === 'horizontal';
  return (
    <nav
      aria-label={ariaLabel ?? 'Tabs'}
      className={cn(
        isHorizontal
          ? 'flex items-center gap-1 border-b border-line-soft'
          : 'flex flex-col gap-0.5',
        className,
      )}
    >
      {items.map((item, idx) => {
        const baseCls = cn(
          'inline-flex items-center gap-2 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper',
          isHorizontal
            ? 'h-9 px-3 -mb-px border-b-2'
            : 'h-8 rounded-md px-3',
        );

        const stateCls = item.active
          ? isHorizontal
            ? 'border-accent text-ink'
            : 'bg-fill text-ink'
          : isHorizontal
            ? 'border-transparent text-ink-3 hover:text-ink hover:border-line-soft'
            : 'text-ink-3 hover:bg-fill hover:text-ink';

        const disabledCls = item.disabled
          ? 'pointer-events-none opacity-50'
          : '';

        const content = (
          <>
            <span>{item.label}</span>
            {item.badge != null ? (
              <span className="text-[10.5px] text-ink-3">{item.badge}</span>
            ) : null}
          </>
        );

        return (
          <Link
            key={`${item.href}-${idx}`}
            href={item.href}
            aria-current={item.active ? 'page' : undefined}
            aria-disabled={item.disabled || undefined}
            tabIndex={item.disabled ? -1 : undefined}
            className={cn(baseCls, stateCls, disabledCls)}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}

export default Tabs;
