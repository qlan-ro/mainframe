/**
 * useDaemonDialogTarget — which daemon-management dialog (add/repair/rename/
 * remove) is open, hoisted ABOVE the daemon-scoped `key={target.id}` subtree.
 *
 * DaemonFooterStatus (the footer trigger + picker Popover, which lives INSIDE
 * the keyed subtree) calls the open-and-close actions; DaemonDialogHost (mounted
 * once at the App root, a SIBLING of the keyed AppShell) reads `dialog` and
 * renders the actual dialog. Because the host is not inside the keyed subtree,
 * a daemon switch — which remounts AppShell — no longer destroys an in-flight
 * dialog (see DaemonDialogHost's module doc for the full story).
 */
import { create } from 'zustand';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';

export type DaemonDialogState =
  | { kind: 'add' }
  | { kind: 'repair'; target: DaemonMeta }
  | { kind: 'rename'; target: DaemonMeta }
  | { kind: 'remove'; target: DaemonMeta }
  | null;

interface DaemonDialogTargetState {
  dialog: DaemonDialogState;
  openAdd: () => void;
  openRepair: (target: DaemonMeta) => void;
  openRename: (target: DaemonMeta) => void;
  openRemove: (target: DaemonMeta) => void;
  close: () => void;
}

export const useDaemonDialogTarget = create<DaemonDialogTargetState>((set) => ({
  dialog: null,
  openAdd: () => set({ dialog: { kind: 'add' } }),
  openRepair: (target) => set({ dialog: { kind: 'repair', target } }),
  openRename: (target) => set({ dialog: { kind: 'rename', target } }),
  openRemove: (target) => set({ dialog: { kind: 'remove', target } }),
  close: () => set({ dialog: null }),
}));
