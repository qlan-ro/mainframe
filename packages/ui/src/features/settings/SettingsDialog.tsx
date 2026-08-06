import { useEffect } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@v2/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getProviderSettings, getGeneralSettings } from '@/lib/api/settings';
import { refreshAdapters } from '@/store/adapters-seed';
import { useSettingsStore } from '../../store/settings';
import { SettingsSidebar } from './SettingsSidebar';
import { SettingsContent } from './SettingsContent';

export function SettingsDialog({ port }: { port: number }) {
  const isOpen = useSettingsStore((s) => s.isOpen);
  const loadProviders = useSettingsStore((s) => s.loadProviders);
  const loadGeneral = useSettingsStore((s) => s.loadGeneral);
  const setLoading = useSettingsStore((s) => s.setLoading);
  const close = useSettingsStore((s) => s.close);

  useEffect(() => {
    if (!isOpen) return;
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
        if (!cancelled) console.warn('[settings/SettingsDialog]', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, port, loadProviders, loadGeneral, setLoading]);

  // Refetch the adapter catalog whenever Settings opens — restores the per-mount
  // resilience lost by reading from the shared store instead of fetching locally.
  // refreshAdapters (NOT seedAdaptersFor): the connection identity hasn't changed here,
  // so the revision baseline must stay intact or a stale same-socket WS event could pass
  // the only-if-newer guard during the fetch window.
  useEffect(() => {
    if (isOpen) refreshAdapters(port);
  }, [isOpen, port]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {/* Full-bleed settings window: two panes with their own scroll, so the
          stock p-6 form padding is dropped (the recorded picker-style deviation). */}
      <DialogContent
        data-testid="settings-dialog"
        showCloseButton={false}
        className="flex h-[600px] max-w-[760px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]"
      >
        {/* Explicit close instead of the stock one: the e2e suite addresses it
            by testid, and the stock button would sit over the header border. */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <DialogTitle>Settings</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" data-testid="settings-dialog-close" aria-label="Close settings">
              <XIcon />
            </Button>
          </DialogClose>
        </header>
        <div className="flex min-h-0 flex-1">
          <SettingsSidebar />
          <ScrollArea className="flex-1">
            <div className="px-6 pt-5 pb-8">
              <SettingsContent port={port} />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
