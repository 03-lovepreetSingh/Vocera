'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Cog,
  CreditCard,
  Key,
  LogOut,
  User,
} from '@/components/icons';
import { cn } from '@/lib/utils';

type ProfileMenuProps = {
  name: string;
  email: string;
  signOutAction: () => Promise<void>;
};

const ITEMS = [
  { href: '/settings/profile', label: 'Profile', icon: User },
  { href: '/settings', label: 'Settings', icon: Cog },
  { href: '/billing', label: 'Billing', icon: CreditCard },
  { href: '/settings/api-keys', label: 'API keys', icon: Key },
];

export function ProfileMenu({ name, email, signOutAction }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 transition',
          open ? 'border-line-soft bg-fill' : 'hover:bg-fill',
        )}
      >
        <span
          aria-hidden
          className="block h-7 w-7 rounded-full"
          style={{ background: 'linear-gradient(135deg, var(--accent), #60a5fa)' }}
        />
        <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-20 w-60 rounded-lg border border-line-softer bg-paper p-2 shadow-token"
        >
          <div className="mb-1.5 flex items-center gap-2.5 border-b border-line-softer px-2.5 pb-2">
            <span
              aria-hidden
              className="block h-9 w-9 shrink-0 rounded-full"
              style={{ background: 'linear-gradient(135deg, var(--accent), #60a5fa)' }}
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{name}</div>
              {email && (
                <div className="truncate text-xs text-ink-3">{email}</div>
              )}
            </div>
          </div>

          {ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-ink-3 transition hover:bg-fill hover:text-ink"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          ))}

          <div className="my-1.5 h-px bg-line-softer" />

          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-err transition hover:bg-fill"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
