/**
 * DaemonFooterStatus — sidebar footer button that shows the active daemon and
 * opens the DaemonPicker in a Popover. Owns the trigger + Popover + unreachable
 * overlay.
 *
 * The daemon-management dialogs (add/repair/rename/remove) are NOT rendered
 * here — this component lives INSIDE the daemon-scoped `key={target.id}`
 * subtree, so a daemon switch remounts it. Dialog RENDERING lives in
 * DaemonDialogHost, mounted as a sibling of the keyed AppShell in
 * DaemonGatedShell (App.tsx), so an in-flight dialog survives a switch. This
 * component only dispatches open*() actions on the shared
 * useDaemonDialogTarget store; see DaemonDialogHost's module doc for the full
 * story.
 *
 * V1 status model:
 *  - Active daemon: derived from useConnectionStatus().state.
 *  - Inactive daemons: optimistically 'connected' (no live polling — documented
 *    known simplification; a fast-follow could poll /health for inactive ones).
 *
 * Visual spec: 17-daemon.jsx DaemonFooterStatus + task-B9-brief.md.
 */
import { useState, useCallback } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ConnectionOverlay } from '@/app/ConnectionOverlay';
import { useConnectionStatus } from '@/app/ConnectionStatusContext';
import { DaemonPicker } from './DaemonPicker';
import { ConnDot, DaemonGlyph } from './DaemonRow';
import type { DaemonStatus } from './DaemonRow';
import { DaemonUnreachableBody } from './DaemonUnreachableBody';
import { useActiveDaemon } from './active-daemon-context';
import { useDaemonRegistry } from './use-daemon-registry';
import { useDaemonDialogTarget } from './use-daemon-dialog-target';
import { useRestoreLastDaemon } from './use-restore-last-daemon';
import { parseRemoteUrl } from './pair-daemon';

// ---------------------------------------------------------------------------
// Derive a DaemonMeta from the active DaemonTarget when the registry hasn't
// loaded it yet (async load gap on initial render).
// ---------------------------------------------------------------------------

function targetToMeta(target: import('@qlan-ro/mainframe-types').DaemonTarget): DaemonMeta {
  const host = parseRemoteUrl(target.baseUrl).host;
  return { id: target.id, kind: target.kind, label: target.label, host };
}

// ---------------------------------------------------------------------------
// DaemonFooterStatus
// ---------------------------------------------------------------------------

export function DaemonFooterStatus() {
  const registry = useDaemonRegistry();
  // Reconnect to the last-used daemon on boot (once the registry has loaded it).
  useRestoreLastDaemon(registry);
  const { target: activeTarget } = useActiveDaemon();
  const { state: connState } = useConnectionStatus();
  const [pickerOpen, setPickerOpen] = useState(false);
  const openAddDialog = useDaemonDialogTarget((s) => s.openAdd);
  const openRenameDialog = useDaemonDialogTarget((s) => s.openRename);
  const openRepairDialog = useDaemonDialogTarget((s) => s.openRepair);
  const openRemoveDialog = useDaemonDialogTarget((s) => s.openRemove);
  const dialogActive = useDaemonDialogTarget((s) => s.dialog != null);

  // Prefer the registry entry (has richer metadata); fall back to the target
  // singleton during the async-load gap so the label/kind are never stale.
  const activeMeta = registry.daemons.find((d) => d.id === registry.activeId) ?? targetToMeta(activeTarget);

  // V1 status model — see module doc.
  const statusOf = useCallback(
    (id: string): DaemonStatus => {
      if (id !== registry.activeId) return 'connected';
      if (connState === 'connected') return 'connected';
      if (connState === 'connecting') return 'connecting';
      return 'unreachable';
    },
    [registry.activeId, connState],
  );

  const handleSwitch = useCallback(
    (d: DaemonMeta) => {
      void registry.switchTo(d.id);
    },
    [registry],
  );

  const handleAdd = useCallback(() => openAddDialog(), [openAddDialog]);
  const handleRename = useCallback((d: DaemonMeta) => openRenameDialog(d), [openRenameDialog]);
  const handleRepair = useCallback((d: DaemonMeta) => openRepairDialog(d), [openRepairDialog]);
  const handleRemove = useCallback((d: DaemonMeta) => openRemoveDialog(d), [openRemoveDialog]);

  const handleSwitchLocal = useCallback(() => {
    void registry.switchTo('local');
  }, [registry]);

  // Unreachable overlay — only when active is REMOTE and WS is disconnected.
  const showUnreachableOverlay = activeMeta.kind === 'remote' && connState === 'disconnected';

  const activeLabel = activeMeta.label;
  const activeKind = activeMeta.kind;
  const activeStatus = statusOf(registry.activeId);

  return (
    <>
      <Popover
        open={pickerOpen}
        onOpenChange={(next) => {
          // Bug-2 guard: a rename/remove dialog (rendered by DaemonDialogHost,
          // hoisted outside this Popover's own portal) can still read as an
          // outside interaction to Radix when it opens/dismisses. Suppress the
          // resulting auto-close while a dialog is active; the picker only
          // closes via an explicit user action (row click / Add / trigger).
          if (!next && dialogActive) return;
          setPickerOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="daemon-footer-trigger"
            className={cn(
              'flex max-w-[168px] min-w-0 items-center gap-[5px] rounded-md px-[5px] py-[2px]',
              'text-micro text-mf-text-3 hover:bg-accent hover:text-foreground transition-colors',
              pickerOpen && 'bg-accent text-foreground',
            )}
          >
            <ConnDot status={activeStatus} size={6} />
            <DaemonGlyph kind={activeKind} size={11} />
            <span className="min-w-0 flex-1 truncate">{activeLabel}</span>
            <ChevronsUpDown size={10} className="shrink-0 text-mf-text-4" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="p-0 w-auto">
          <DaemonPicker
            daemons={registry.daemons}
            statusOf={statusOf}
            activeId={registry.activeId}
            onSwitch={handleSwitch}
            onAdd={handleAdd}
            onRename={handleRename}
            onRepair={handleRepair}
            onRemove={handleRemove}
            close={() => setPickerOpen(false)}
          />
        </PopoverContent>
      </Popover>

      {/* ── Unreachable overlay ────────────────────────────────────── */}
      <ConnectionOverlay open={showUnreachableOverlay}>
        <DaemonUnreachableBody target={activeMeta} onSwitchLocal={handleSwitchLocal} />
      </ConnectionOverlay>
    </>
  );
}
