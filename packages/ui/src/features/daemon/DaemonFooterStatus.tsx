/**
 * DaemonFooterStatus — sidebar footer button that shows the active daemon and
 * opens the DaemonPicker in a Popover. Owns the full dialog + overlay state
 * machine (add/rename/remove/repair dialogs; unreachable overlay).
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
import { AddRemoteDialog } from './AddRemoteDialog';
import { DaemonSmallDialog } from './DaemonSmallDialog';
import { DaemonUnreachableBody } from './DaemonUnreachableBody';
import { useActiveDaemon } from './active-daemon-context';
import { useDaemonRegistry } from './use-daemon-registry';

// ---------------------------------------------------------------------------
// Dialog state
// ---------------------------------------------------------------------------

type DialogState =
  | { kind: 'add' }
  | { kind: 'repair'; target: DaemonMeta }
  | { kind: 'rename'; target: DaemonMeta }
  | { kind: 'remove'; target: DaemonMeta }
  | null;

// ---------------------------------------------------------------------------
// Derive a DaemonMeta from the active DaemonTarget when the registry hasn't
// loaded it yet (async load gap on initial render).
// ---------------------------------------------------------------------------

function targetToMeta(target: import('@qlan-ro/mainframe-types').DaemonTarget): DaemonMeta {
  const host = target.baseUrl.replace(/^https?:\/\//, '');
  return { id: target.id, kind: target.kind, label: target.label, host };
}

// ---------------------------------------------------------------------------
// DaemonFooterStatus
// ---------------------------------------------------------------------------

export function DaemonFooterStatus() {
  const registry = useDaemonRegistry();
  const { target: activeTarget } = useActiveDaemon();
  const { state: connState } = useConnectionStatus();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);

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

  const handleAdd = useCallback(() => setDialog({ kind: 'add' }), []);
  const handleRename = useCallback((d: DaemonMeta) => setDialog({ kind: 'rename', target: d }), []);
  const handleRepair = useCallback((d: DaemonMeta) => setDialog({ kind: 'repair', target: d }), []);
  const handleRemove = useCallback((d: DaemonMeta) => setDialog({ kind: 'remove', target: d }), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const handleRenameConfirm = useCallback(
    async (label?: string) => {
      if (dialog?.kind === 'rename' && label != null) {
        await registry.rename(dialog.target.id, label);
      }
      setDialog(null);
    },
    [dialog, registry],
  );

  const handleRemoveConfirm = useCallback(async () => {
    if (dialog?.kind === 'remove') {
      await registry.remove(dialog.target.id);
    }
    setDialog(null);
  }, [dialog, registry]);

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
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
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
            <ConnDot status={activeStatus} />
            <DaemonGlyph kind={activeKind} />
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

      {/* ── Dialogs ────────────────────────────────────────────────── */}
      <AddRemoteDialog
        open={dialog?.kind === 'add' || dialog?.kind === 'repair'}
        mode={dialog?.kind === 'repair' ? 'repair' : 'add'}
        target={dialog?.kind === 'repair' ? dialog.target : undefined}
        onClose={closeDialog}
        onDone={closeDialog}
      />

      {(dialog?.kind === 'rename' || dialog?.kind === 'remove') && (
        <DaemonSmallDialog
          open
          kind={dialog.kind}
          target={dialog.target}
          onClose={closeDialog}
          onConfirm={
            dialog.kind === 'rename' ? (label) => void handleRenameConfirm(label) : () => void handleRemoveConfirm()
          }
        />
      )}

      {/* ── Unreachable overlay ────────────────────────────────────── */}
      <ConnectionOverlay open={showUnreachableOverlay}>
        <DaemonUnreachableBody target={activeMeta} onSwitchLocal={handleSwitchLocal} />
      </ConnectionOverlay>
    </>
  );
}
