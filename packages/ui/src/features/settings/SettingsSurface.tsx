/**
 * SettingsSurface — the body's Settings view (the `SidebarInset` content
 * while `sidebarView` is 'settings', D1/D2). The selected pane, scrollable,
 * capped to a readable width and padded (replaces the old `SettingsDialog`'s
 * two-pane window — the sidebar now carries the category list, see
 * `SettingsSidebar.tsx`). Loads the provider/general config and refreshes
 * the adapter catalog on mount, same as the dialog did on every open —
 * mount IS open now, since this only renders while the view is active.
 */
import { useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getProviderSettings, getGeneralSettings } from '@/lib/api/settings';
import { refreshAdapters } from '@/store/adapters-seed';
import { useSettingsStore } from '../../store/settings';
import { SettingsContent } from './SettingsContent';
import { SETTINGS_TABS } from './settings-tabs';

export function SettingsSurface({ port }: { port: number }) {
  const activeTab = useSettingsStore((s) => s.activeTab);
  const loadProviders = useSettingsStore((s) => s.loadProviders);
  const loadGeneral = useSettingsStore((s) => s.loadGeneral);
  const setLoading = useSettingsStore((s) => s.setLoading);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getProviderSettings(port).then((p) => {
        if (!cancelled) loadProviders(p);
      }),
      getGeneralSettings(port).then((g) => {
        if (!cancelled) loadGeneral(g);
      }),
    ])
      .catch((err: unknown) => {
        if (!cancelled) console.warn('[settings/SettingsSurface]', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [port, loadProviders, loadGeneral, setLoading]);

  // Refetch the adapter catalog on mount — restores the per-mount resilience
  // lost by reading from the shared store instead of fetching locally.
  // refreshAdapters (NOT seedAdaptersFor): the connection identity hasn't
  // changed here, so the revision baseline must stay intact or a stale
  // same-socket WS event could pass the only-if-newer guard during the fetch
  // window.
  useEffect(() => {
    void refreshAdapters(port);
  }, [port]);

  const title = SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label ?? '';

  return (
    <div data-testid="settings-surface" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 pt-5 pb-8">
          <h1 className="mb-4 text-lg font-semibold text-foreground">{title}</h1>
          <SettingsContent port={port} />
        </div>
      </ScrollArea>
    </div>
  );
}
