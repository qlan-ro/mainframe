/**
 * panel-control-store — the session panel's TRANSIENT state, per chat column.
 *
 * The persisted "is the panel open" bit lives in `store/ui-prefs`
 * (`sessionPanelOpen`); this store holds what must not persist: whether a
 * column's panel is currently floated over the transcript because the column
 * is too narrow to dock it. Keyed by column id (`'main'` for the single chat
 * surface, `'zone:<id>'` for a split zone) so two zones never share a float.
 *
 * It is a store, not hook state, so the title bar's details toggle — which
 * lives in shell chrome, nowhere near the column — can drive the same panel the
 * column's own hook renders. `togglePanel(columnId, fits)` carries the one rule
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
  overlayOpen: Partial<Record<PanelColumnId, boolean>>;
  /** Each column's measured verdict — published by its `use-session-panel-state`
   *  so the title bar's toggle, which cannot measure, can pass it back in. Absent
   *  (unmeasured) reads as "fits": a brand-new column must not float on its first click. */
  fits: Partial<Record<PanelColumnId, boolean>>;
  setOverlayOpen: (columnId: PanelColumnId, open: boolean) => void;
  setFits: (columnId: PanelColumnId, fits: boolean) => void;
  /**
   * The details toggle. `fits` is the caller's measured verdict for the column
   * (the store cannot measure). Open + fits → close. Open + does not fit →
   * float if not floating, else close (and un-float). Closed → open, and
   * float when the column does not fit.
   */
  togglePanel: (columnId: PanelColumnId, fits: boolean) => void;
}

export const usePanelControl = create<PanelControlState>((set, get) => ({
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

  togglePanel: (columnId, fits) => {
    const prefs = useUiPrefs.getState();
    const open = prefs.sessionPanelOpen;
    const floating = get().overlayOpen[columnId] ?? false;
    if (open && !fits && !floating) {
      // Open but not showing: the click asked to SEE the panel, so float it
      // rather than silently closing it.
      get().setOverlayOpen(columnId, true);
      return;
    }
    prefs.setSessionPanelOpen(!open);
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
