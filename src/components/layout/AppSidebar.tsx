'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Bot, Cog, Layers, LayoutDashboard, Phone } from '@/components/icons';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agents', label: 'AI Agents', icon: Bot },
  { href: '/voice', label: 'Voice Agents', icon: Phone },
  { href: '/logs', label: 'Call Logs', icon: Layers },
  { href: '/analysis', label: 'Analysis', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Cog },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-[220px] shrink-0 flex-col border-r border-line-soft bg-paper px-3 py-5 md:flex">
      <Link href="/dashboard" className="mb-6 px-2 font-mono text-base font-semibold tracking-tight">
        Vocera
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition',
                active ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-fill hover:text-ink',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
