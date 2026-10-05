/**
 * The nav rail's daemon switcher (bottom group): a device glyph with the
 * connection dot in its corner — name and address in the hint — that opens the
 * picker to the right. Owns the rename/remove dialog state.
 *
 * Status model, unchanged from the shipped switcher: only the active daemon
 * reflects live connection state; inactive ones read `connected`, since nothing
 * polls their health.
 */
import { useCallback, useState, useSyncExternalStore, type ComponentProps } from 'react';
import type { DaemonMeta, DaemonTarget } from '@qlan-ro/mainframe-types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
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
  className,
  ...props
}: { meta: DaemonMeta; status: DaemonStatus } & ComponentProps<'button'>) {
  return (
    // Same 38px / 10px-radius button as NavRailButton. The ConnDot stays INSIDE
    // the trigger: every e2e readiness wait looks for its aria-label there.
    <button
      type="button"
      data-testid="shell-rail-daemon"
      data-tut="daemon"
      className={cn(
        'relative flex size-9.5 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors',
        'hover:bg-sidebar-accent hover:text-foreground data-[state=open]:bg-sidebar-accent',
        className,
      )}
      {...props}
    >
      <DaemonGlyph kind={meta.kind} className="size-5 text-current" />
      <span className="absolute right-1.5 bottom-1.5 flex rounded-full ring-2 ring-sidebar">
        <ConnDot status={status} />
      </span>
      <span data-testid="shell-rail-daemon-label" className="sr-only">
        {meta.label}
      </span>
    </button>
  );
}

function hintFor(meta: DaemonMeta): string {
  return meta.host ? `${meta.label} · ${meta.host}` : meta.label;
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
    <>
      <DropdownMenu>
        {/* Hint outside the trigger (a Tooltip root forwards nothing to the DOM). */}
        <Hint label={hintFor(activeMeta)} side="right">
          <DropdownMenuTrigger asChild>
            <SwitcherTrigger meta={activeMeta} status={statusOf(registry.activeId)} />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent side="right" align="end" className="w-80">
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
        <DaemonSmallDialog kind={dialog.kind} target={dialog.target} onClose={closeDialog} onConfirm={handleConfirm} />
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
    </>
  );
}
