'use client';

/**
 * Settings sub-navigation. Active state is computed from the URL so the
 * highlight survives soft navigations and refreshes alike.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface Tab {
  href: string;
  label: string;
  // Some tabs link to top-level pages (Billing, API keys, Audit log) and
  // shouldn't ever be highlighted as the "current" settings tab.
  external?: boolean;
}

const TABS: readonly Tab[] = [
  { href: '/settings', label: 'Profile' },
  { href: '/settings/workspace', label: 'Workspace' },
  { href: '/settings/members', label: 'Members' },
  { href: '/settings/api-keys', label: 'API keys' },
  { href: '/settings/notifications', label: 'Notifications' },
  { href: '/settings/security', label: 'Security' },
  { href: '/billing', label: 'Billing', external: true },
  { href: '/logs', label: 'Audit log', external: true },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings sections"
      className="hidden w-[200px] shrink-0 border-r border-line-soft bg-paper px-3 py-5 md:block"
    >
      <ul className="flex flex-col gap-1">
        {TABS.map((tab) => {
          // Profile (/settings) is exact-match; everything else uses startsWith
          // so nested sub-pages light up the parent tab.
          const active = tab.external
            ? false
            : tab.href === '/settings'
              ? pathname === '/settings'
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={cn(
                  'block rounded-md px-3 py-1.5 text-sm transition',
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-3 hover:bg-fill hover:text-ink',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
