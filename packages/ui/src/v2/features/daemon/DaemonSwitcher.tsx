/**
 * The sidebar-footer daemon switcher: shows the active daemon and opens the
 * picker. Owns the rename/remove dialog state.
 *
 * Status model, unchanged from the shipped switcher: only the active daemon
 * reflects live connection state; inactive ones read `connected`, since nothing
 * polls their health.
 */
import { useCallback, useState, type ComponentProps } from 'react';
import { ChevronsUpDownIcon } from 'lucide-react';
import type { DaemonMeta, DaemonTarget } from '@qlan-ro/mainframe-types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@v2/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@v2/components/ui/sidebar';
import { useConnectionStatus } from '@/app/ConnectionStatusContext';
import { useActiveDaemon } from '@/features/daemon/active-daemon-context';
import { parseRemoteUrl } from '@/features/daemon/pair-daemon';
import { useDaemonRegistry } from '@/features/daemon/use-daemon-registry';
import { useRestoreLastDaemon } from '@/features/daemon/use-restore-last-daemon';
import { ConnDot, DaemonGlyph, type DaemonStatus } from './daemon-status';
import { DaemonMenuItems } from './DaemonMenuItems';
import { DaemonSmallDialog, type SmallDialogKind } from './DaemonSmallDialog';

type DialogState = { kind: SmallDialogKind; target: DaemonMeta } | null;

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

  const activeMeta = registry.daemons.find((d) => d.id === registry.activeId) ?? targetToMeta(target);

  const statusOf = useCallback(
    (id: string): DaemonStatus => {
      if (id !== registry.activeId) return 'connected';
      if (connState === 'connected') return 'connected';
      if (connState === 'connecting') return 'connecting';
      return 'unreachable';
    },
    [registry.activeId, connState],
  );

  const handleSwitch = useCallback((d: DaemonMeta) => void registry.switchTo(d.id), [registry]);
  const closeDialog = useCallback(() => setDialog(null), []);

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
              onRemove={(d) => setDialog({ kind: 'remove', target: d })}
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
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
