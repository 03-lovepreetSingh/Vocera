'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { signOutAction } from '@/app/(console)/sign-out';
import { cn } from '@/lib/utils';

type ProfileUser = {
  name?: string | null;
  email: string;
  image?: string | null;
};

type ProfileDropdownProps = {
  user: ProfileUser;
};

const MENU_ITEMS = [
  { href: '/settings', label: 'Profile' },
  { href: '/settings/workspace', label: 'Workspace settings' },
  { href: '/settings/billing', label: 'Billing' },
  { href: '/integrations', label: 'API keys' },
] as const;

function getInitials(name: string | null | undefined, email: string): string {
  const source = (name ?? '').trim();
  if (source.length > 0) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    }
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (email.trim()[0] ?? '?').toUpperCase();
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function SignOutIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9.5 2.5h-5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h5" />
      <path d="M11 5.5L13.5 8 11 10.5" />
      <path d="M13.5 8H6.5" />
    </svg>
  );
}

export function ProfileDropdown({ user }: ProfileDropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const displayName = (user.name ?? '').trim() || user.email.split('@')[0] || 'Account';
  const initials = getInitials(user.name, user.email);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open profile menu"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-transparent px-1 py-1 transition',
          open ? 'border-line-soft bg-fill' : 'hover:bg-fill',
        )}
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-paper"
          >
            {initials}
          </span>
        )}
        <ChevronDownIcon className="h-3.5 w-3.5 text-ink-3" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Profile menu"
          className="absolute right-0 top-[calc(100%+8px)] z-20 w-60 rounded-md border border-line-soft bg-paper p-1.5 shadow-sm"
        >
          <div className="border-b border-line-soft px-2.5 pb-2 pt-1.5">
            <div className="truncate text-sm font-semibold text-ink">
              {displayName}
            </div>
            {user.email && (
              <div className="truncate text-xs text-ink-3">{user.email}</div>
            )}
          </div>

          <div className="py-1">
            {MENU_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center rounded-md px-2.5 py-1.5 text-[13px] text-ink-3 transition hover:bg-fill hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="my-1 h-px bg-line-soft" />

          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-err transition hover:bg-fill"
            >
              <SignOutIcon className="h-3.5 w-3.5" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default ProfileDropdown;
