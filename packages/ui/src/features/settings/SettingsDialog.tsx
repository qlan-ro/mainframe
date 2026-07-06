import { useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getProviderSettings, getGeneralSettings } from '@/lib/api/settings';
import { refreshAdapters } from '@/store/adapters-seed';
import { useSettingsStore } from '../../store/settings';
import { SettingsSidebar } from './SettingsSidebar';
import { SettingsContent } from './SettingsContent';

function SettingsDialogOverlay() {
  return (
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-mf-scrim backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
  );
}

function SettingsDialogCloseBtn() {
  const close = useSettingsStore((s) => s.close);
  return (
    <button
      type="button"
      data-testid="settings-dialog-close"
      onClick={close}
      className="flex size-[28px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent focus:outline-none"
      aria-label="Close settings"
    >
      <X size={13} />
      <span className="sr-only">Close</span>
    </button>
  );
}

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
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPrimitive.Portal>
        <SettingsDialogOverlay />
        <DialogPrimitive.Content
          data-testid="settings-dialog"
          className="fixed left-1/2 top-1/2 z-50 flex h-[600px] w-full max-w-[760px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[var(--mf-shadow-modal)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <header className="flex h-[50px] shrink-0 items-center justify-between border-b-[0.5px] border-border bg-mf-content2 px-[18px]">
            <DialogPrimitive.Title className="text-heading font-bold tracking-tight text-foreground">
              Settings
            </DialogPrimitive.Title>
            <SettingsDialogCloseBtn />
          </header>
          <div className="flex min-h-0 flex-1">
            <SettingsSidebar />
            <ScrollArea className="flex-1">
              <div className="px-[26px] pb-[32px] pt-[22px]">
                <SettingsContent port={port} />
              </div>
            </ScrollArea>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
