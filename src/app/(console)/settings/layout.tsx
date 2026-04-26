/**
 * Settings layout — two-level navigation.
 *
 * The console sidebar (AppSidebar) handles top-level pages; this inner sidebar
 * lets users move between settings sub-pages without losing the topbar context.
 * Tabs that aren't owned here (Billing, Audit log, API keys) link to their own
 * top-level routes — they live elsewhere in the app.
 */
import { AppTopbar } from '@/components/layout/AppTopbar';
import { SettingsTabs } from './tabs';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppTopbar title="Settings" />
      <div className="flex min-h-0 flex-1">
        <SettingsTabs />
        <main className="flex-1 overflow-auto bg-fill px-8 py-7">
          <div className="mx-auto max-w-2xl">{children}</div>
        </main>
      </div>
    </>
  );
}
