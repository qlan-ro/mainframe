/**
 * panel-control-store — the session panel's TRANSIENT state, per chat column.
 *
 * Open state is PER COLUMN (`'main'` for the single chat surface,
 * `'zone:<id>'` for a split zone), so the two halves of a split open and close
 * their panels independently. `'main'` persists through `store/ui-prefs`
 * (`sessionPanelOpen`); a zone keeps a transient override that starts from that
 * persisted bit. The store also holds what must not persist: whether a column's
 * panel is floated over the transcript because the column is too narrow to
 * dock it.
 *
 * It is a store, not hook state, so each column's toggle (`SessionPanelToggle`,
 * in the chat column / zone strip) and the column's own hook drive one panel. `togglePanel(columnId, fits)` carries the one rule
 * the old rail had: on a column that does not fit, a click on an open-but-
 * hidden panel floats it rather than closing it, and opening also floats.
 */
import { create } from 'zustand';
import { useUiPrefs } from '@/store/ui-prefs';

export type PanelColumnId = 'main' | `zone:${string}`;

export function zoneColumnId(zoneId: string): PanelColumnId {
  return `zone:${zoneId}`;
}

interface PanelControlState {
  /** Zone overrides of the open bit; `'main'` reads/writes ui-prefs instead. */
  open: Partial<Record<PanelColumnId, boolean>>;
  overlayOpen: Partial<Record<PanelColumnId, boolean>>;
  /** Each column's measured verdict — published by its `use-session-panel-state`
   *  so the title bar's toggle, which cannot measure, can pass it back in. Absent
   *  (unmeasured) reads as "fits": a brand-new column must not float on its first click. */
  fits: Partial<Record<PanelColumnId, boolean>>;
  setOverlayOpen: (columnId: PanelColumnId, open: boolean) => void;
  setPanelOpen: (columnId: PanelColumnId, open: boolean) => void;
  setFits: (columnId: PanelColumnId, fits: boolean) => void;
  /**
   * The details toggle. `fits` is the caller's measured verdict for the column
   * (the store cannot measure). Open + fits → close. Open + does not fit →
   * float if not floating, else close (and un-float). Closed → open, and
   * float when the column does not fit.
   */
  togglePanel: (columnId: PanelColumnId, fits: boolean) => void;
}

/** The column's open bit, read outside React (the toggle's rule). */
export function readPanelOpen(columnId: PanelColumnId): boolean {
  const persisted = useUiPrefs.getState().sessionPanelOpen;
  if (columnId === 'main') return persisted;
  return usePanelControl.getState().open[columnId] ?? persisted;
}

/** The column's open bit, reactively. */
export function usePanelOpen(columnId: PanelColumnId): boolean {
  const persisted = useUiPrefs((s) => s.sessionPanelOpen);
  const override = usePanelControl((s) => s.open[columnId]);
  return columnId === 'main' ? persisted : (override ?? persisted);
}

export const usePanelControl = create<PanelControlState>((set, get) => ({
  open: {},
  overlayOpen: {},
  fits: {},

  setFits: (columnId, fits) =>
    set((s) => {
      if ((s.fits[columnId] ?? true) === fits) return s;
      return { fits: { ...s.fits, [columnId]: fits } };
    }),

  setOverlayOpen: (columnId, open) =>
    set((s) => {
      if ((s.overlayOpen[columnId] ?? false) === open) return s;
      return { overlayOpen: { ...s.overlayOpen, [columnId]: open } };
    }),

  setPanelOpen: (columnId, open) => {
    if (columnId === 'main') {
      useUiPrefs.getState().setSessionPanelOpen(open);
      return;
    }
    set((s) => (s.open[columnId] === open ? s : { open: { ...s.open, [columnId]: open } }));
  },

  togglePanel: (columnId, fits) => {
    const open = readPanelOpen(columnId);
    const floating = get().overlayOpen[columnId] ?? false;
    if (open && !fits && !floating) {
      // Open but not showing: the click asked to SEE the panel, so float it
      // rather than silently closing it.
      get().setOverlayOpen(columnId, true);
      return;
    }
    get().setPanelOpen(columnId, !open);
    get().setOverlayOpen(columnId, !open && !fits);
  },
}));

export const selectFits =
  (columnId: PanelColumnId) =>
  (s: PanelControlState): boolean =>
    s.fits[columnId] ?? true;

export const selectOverlayOpen =
  (columnId: PanelColumnId) =>
  (s: PanelControlState): boolean =>
    s.overlayOpen[columnId] ?? false;
