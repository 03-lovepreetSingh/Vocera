import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional small uppercase label rendered above the children. */
  title?: ReactNode;
  /** Optional element rendered on the right side of the title row. */
  action?: ReactNode;
  children?: ReactNode;
}

/**
 * Card — bordered surface using design tokens.
 * border-line-soft + bg-paper + rounded-lg + p-5.
 */
export function Card({
  title,
  action,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      className={cn(
        'rounded-lg border border-line-soft bg-paper p-5 shadow-token-sm',
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              {title}
            </span>
          ) : (
            <span />
          )}
          {action ? <div className="flex items-center gap-2">{action}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}

export default Card;
