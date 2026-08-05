/**
 * The sidebar-footer daemon switcher: shows the active daemon and opens the
 * picker. Owns the rename/remove dialog state.
 *
 * Status model, unchanged from the shipped switcher: only the active daemon
 * reflects live connection state; inactive ones read `connected`, since nothing
 * polls their health.
 */
import { useCallback, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { ChevronsUpDownIcon } from 'lucide-react';
import type { DaemonMeta, DaemonTarget } from '@qlan-ro/mainframe-types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@v2/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@v2/components/ui/sidebar';
// Legacy island: ConnectionOverlay is the app-level window-state overlay; it
// ports with the window-states pass.
import { ConnectionOverlay } from '@/app/ConnectionOverlay';
import { useConnectionStatus } from '@/app/ConnectionStatusContext';
import { getAuthFailureSnapshot, hasAuthFailure, subscribeAuthFailures } from '@/lib/daemon/auth-failure-store';
import { useActiveDaemon } from '@/features/daemon/active-daemon-context';
import { parseRemoteUrl } from '@/features/daemon/pair-daemon';
import { AddRemoteDialog, type DialogMode } from './AddRemoteDialog';
import { DaemonUnreachableBody } from './DaemonUnreachableBody';
import { useDaemonRegistry } from '@/features/daemon/use-daemon-registry';
import { useRestoreLastDaemon } from '@/features/daemon/use-restore-last-daemon';
import { ConnDot, DaemonGlyph, type DaemonStatus } from './daemon-status';
import { DaemonMenuItems } from './DaemonMenuItems';
import { DaemonSmallDialog, type SmallDialogKind } from './DaemonSmallDialog';

type DialogState = { kind: SmallDialogKind; target: DaemonMeta } | null;
type PairingState = { mode: DialogMode; target?: DaemonMeta } | null;

/** The registry loads asynchronously; until it does, the target is all we have. */
function targetToMeta(target: DaemonTarget): DaemonMeta {
  return { id: target.id, kind: target.kind, label: target.label, host: parseRemoteUrl(target.baseUrl).host };
}

// `props` carries what `DropdownMenuTrigger asChild` injects — onClick, ref, the
// aria wiring. Dropping it leaves a button that renders but never opens.
function SwitcherTrigger({
  meta,
  status,
  ...props
}: { meta: DaemonMeta; status: DaemonStatus } & ComponentProps<typeof SidebarMenuButton>) {
  return (
    <SidebarMenuButton size="lg" data-testid="daemon-footer-trigger" {...props}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent">
        <DaemonGlyph kind={meta.kind} />
      </span>
      <span className="grid min-w-0 flex-1 text-left leading-tight">
        <span className="flex items-center gap-1.5">
          <span
            data-testid="daemon-footer-trigger-label"
            className="min-w-0 truncate font-medium text-muted-foreground"
          >
            {meta.label}
          </span>
          {/* Dot only: the word is spelled out per-daemon in the picker, and on
              the trigger it just repeated what the colour already said. */}
          <ConnDot status={status} />
        </span>
        {meta.host && (
          <span data-testid="daemon-footer-trigger-host" className="truncate font-mono text-xs text-muted-foreground">
            {meta.host}
          </span>
        )}
      </span>
      <ChevronsUpDownIcon className="ml-auto shrink-0" />
    </SidebarMenuButton>
  );
}

export function DaemonSwitcher() {
  const registry = useDaemonRegistry();
  useRestoreLastDaemon(registry);
  const { target } = useActiveDaemon();
  const { state: connState } = useConnectionStatus();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pairing, setPairing] = useState<PairingState>(null);

  const activeMeta = registry.daemons.find((d) => d.id === registry.activeId) ?? targetToMeta(target);

  // Re-derive every status whenever an auth-failure marker flips; the snapshot
  // itself carries no data, statusOf reads the marker per id.
  const authSnapshot = useSyncExternalStore(subscribeAuthFailures, getAuthFailureSnapshot);

  const statusOf = useCallback(
    (id: string): DaemonStatus => {
      const isActive = id === registry.activeId;
      // A dead socket outranks a stale token: re-pairing can't reach the daemon.
      if (isActive && connState === 'disconnected') return 'unreachable';
      if (hasAuthFailure(id)) return 'needs-repair';
      if (!isActive) return 'connected';
      return connState === 'connected' ? 'connected' : 'connecting';
    },
    // authSnapshot invalidates the memo; hasAuthFailure reads live state.
    [registry.activeId, connState, authSnapshot],
  );

  const handleSwitch = useCallback((d: DaemonMeta) => void registry.switchTo(d.id), [registry]);
  const handleSwitchLocal = useCallback(() => void registry.switchTo('local'), [registry]);
  const closeDialog = useCallback(() => setDialog(null), []);

  // Only when the ACTIVE daemon is remote and the socket is down — the local
  // disconnect case is owned by App's generic reconnect overlay.
  const showUnreachableOverlay = activeMeta.kind === 'remote' && connState === 'disconnected';

  const handleConfirm = useCallback(
    (label?: string) => {
      if (dialog == null) return;
      if (dialog.kind === 'rename' && label != null) void registry.rename(dialog.target.id, label);
      if (dialog.kind === 'remove') void registry.remove(dialog.target.id);
      setDialog(null);
    },
    [dialog, registry],
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SwitcherTrigger meta={activeMeta} status={statusOf(registry.activeId)} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-80">
            <DaemonMenuItems
              daemons={registry.daemons}
              statusOf={statusOf}
              activeId={registry.activeId}
              onSwitch={handleSwitch}
              onRename={(d) => setDialog({ kind: 'rename', target: d })}
              onRepair={(d) => setPairing({ mode: 'repair', target: d })}
              onRemove={(d) => setDialog({ kind: 'remove', target: d })}
              onAddRemote={() => setPairing({ mode: 'add' })}
            />
          </DropdownMenuContent>
        </DropdownMenu>

        {dialog != null && (
          <DaemonSmallDialog
            kind={dialog.kind}
            target={dialog.target}
            onClose={closeDialog}
            onConfirm={handleConfirm}
          />
        )}

        {/* onDone stays a no-op: the dialog fires it the instant pairing
            succeeds, then defers its own onClose ~800ms so the "Paired" notice
            stays visible. Closing here would collapse that grace window. */}
        <AddRemoteDialog
          open={pairing != null}
          mode={pairing?.mode ?? 'add'}
          target={pairing?.target}
          onClose={() => setPairing(null)}
          onDone={() => undefined}
        />

        <ConnectionOverlay open={showUnreachableOverlay}>
          <DaemonUnreachableBody target={activeMeta} onSwitchLocal={handleSwitchLocal} />
        </ConnectionOverlay>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
