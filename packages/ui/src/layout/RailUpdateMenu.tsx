/**
 * RailUpdateMenu — the rail update button once a provider CLI has an update
 * (todo #405). One row per pending update: Mainframe's own (download /
 * restart, same as the plain button) and each provider CLI (update in place
 * on the daemon host). A CLI that can't be updated in-app, or whose last run
 * failed, opens Settings → Providers, where the output and the manual command
 * live.
 */
import { Download, LoaderCircle, RefreshCw, Settings, TriangleAlert } from 'lucide-react';
import type { ProviderCliStatus, UpdateStatus } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAdapters } from '@/store/adapters';
import { applyProviderCliUpdateStarted } from '@/store/cli-update';
import { useSettingsStore } from '@/store/settings';
import { useUiPrefs } from '@/store/ui-prefs';
import { updateProviderCli } from '@/lib/api/cli-update';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { NavRailButton } from './NavRailButton';

interface RailUpdateMenuProps {
  app: UpdateStatus;
  appHint: string | null;
  onAppAction: () => void;
  clis: ProviderCliStatus[];
}

function isRunning(status: ProviderCliStatus): boolean {
  return status.update?.state === 'running';
}

function triggerHint(appHint: string | null, clis: ProviderCliStatus[], nameOf: (id: string) => string): string {
  const running = clis.find(isRunning);
  if (running) return `Updating ${nameOf(running.adapterId)}…`;
  const count = clis.length + (appHint == null ? 0 : 1);
  return count === 1 ? `An update is available for ${nameOf(clis[0]?.adapterId ?? '')}` : `${count} updates available`;
}

function cliDetail(status: ProviderCliStatus): string {
  if (isRunning(status)) return 'Updating…';
  if (status.update?.state === 'failed') return 'Update failed · open Settings';
  const versions = `${status.installedVersion ?? '?'} → ${status.latestVersion ?? '?'}`;
  return status.canUpdate ? versions : `${versions} · update manually`;
}

export function RailUpdateMenu({ app, appHint, onAppAction, clis }: RailUpdateMenuProps) {
  const port = useDaemonPort();
  const adapters = useAdapters();
  const nameOf = (id: string) => adapters.find((a) => a.id === id)?.name ?? id;
  const anyRunning = clis.some(isRunning);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);
  const setSelectedProvider = useSettingsStore((s) => s.setSelectedProvider);
  const setSidebarView = useUiPrefs((s) => s.setSidebarView);
  const setSidebarVisible = useUiPrefs((s) => s.setSidebarVisible);

  const openProviderSettings = (adapterId: string) => {
    setActiveTab('providers');
    setSelectedProvider(adapterId);
    setSidebarView('settings');
    setSidebarVisible(true);
  };

  const handleCli = (status: ProviderCliStatus) => {
    if (isRunning(status)) return;
    if (!status.canUpdate || status.update?.state === 'failed') {
      openProviderSettings(status.adapterId);
      return;
    }
    updateProviderCli(status.adapterId, port)
      .then(applyProviderCliUpdateStarted)
      .catch((err: unknown) => {
        console.warn('[layout/RailUpdateMenu] update failed to start', err);
        openProviderSettings(status.adapterId);
      });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <NavRailButton
          testId="shell-rail-update"
          label={triggerHint(appHint, clis, nameOf)}
          icon={anyRunning ? LoaderCircle : Download}
          className={anyRunning ? '[&>svg]:animate-spin' : undefined}
          dot
          dotTestId="shell-rail-update-dot"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-72" data-testid="shell-rail-update-menu">
        <DropdownMenuLabel>Updates</DropdownMenuLabel>
        {appHint != null && (
          <DropdownMenuItem
            data-testid="shell-rail-update-app"
            disabled={app.state === 'downloading'}
            onSelect={onAppAction}
          >
            {app.state === 'downloaded' ? <RefreshCw /> : <Download />}
            <span className="flex min-w-0 flex-col">
              <span>Mainframe</span>
              <span className="text-xs text-muted-foreground">{appHint}</span>
            </span>
          </DropdownMenuItem>
        )}
        {clis.map((status) => (
          <DropdownMenuItem
            key={status.adapterId}
            data-testid={`shell-rail-update-cli-${status.adapterId}`}
            disabled={isRunning(status)}
            onSelect={() => handleCli(status)}
          >
            {isRunning(status) ? (
              <LoaderCircle className="animate-spin" />
            ) : status.update?.state === 'failed' ? (
              <TriangleAlert className="text-destructive" />
            ) : (
              <Download />
            )}
            <span className="flex min-w-0 flex-col">
              <span>{nameOf(status.adapterId)} CLI</span>
              <span className="text-xs text-muted-foreground">{cliDetail(status)}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="shell-rail-update-settings"
          onSelect={() => openProviderSettings(clis[0]?.adapterId ?? '')}
        >
          <Settings />
          Provider settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
