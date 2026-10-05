/**
 * use-session-panel-state — the session panel's state machine: which mode the
 * panel is in (inline / overlay / hidden) for one chat column.
 *
 * No panel state is held here. `store/ui-prefs.ts` owns the ONE open bit (so
 * an open panel survives a remount and a session switch) and
 * `panel-control-store` owns the transient per-column float — keyed by
 * `columnId` so the column's details toggle (chat column / zone strip)
 * drives the same panel this hook renders. The hook measures the column and
 * publishes its `fits` verdict to that store for the toggle to read.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useUiPrefs, isSessionPanelSectionOpen, type SessionPanelOpenSectionId } from '@/store/ui-prefs';
import { columnFitsPanel, derivePanelMode, type PanelMode } from './panel-mode';
import { selectOverlayOpen, usePanelControl, usePanelOpen, type PanelColumnId } from './panel-control-store';

export interface SessionPanelState {
  /** Goes on the chat column's horizontal row — the FULL width, before the
   *  docked panel takes its 300, since the mode decides whether that width can
   *  be shared. Explicit, rather than the panel root's `parentElement`, so a
   *  split surface measures the row it shrinks.
   *
   *  A CALLBACK ref backed by state, not a RefObject, and that is load-bearing:
   *  on a cold boot the chat surface shows its initializing branch first, so the
   *  row does not exist when this hook's effects first run. A `[]`-deps effect
   *  reading a RefObject box measured `null` once and never retried — the panel
   *  stayed `hidden` forever in the packaged app, where the daemon spawn always
   *  loses that race (dev servers boot fast enough to always win it). */
  hostRef: (el: HTMLElement | null) => void;
  /** Goes on the panel root; light dismiss treats it as "inside". */
  rootRef: RefObject<HTMLDivElement | null>;
  surfaceWidth: number;
  mode: PanelMode;
  /** The persisted bit — one for the whole panel. */
  isPanelOpen: () => boolean;
  /** Open AND showing — false for an open panel parked on a short column. */
  isPanelVisible: () => boolean;
  /** The details toggle. Opening on a short column also floats the panel over
   *  the transcript — the click asked to see the panel, not just to arm a bit. */
  togglePanel: () => void;
  isSectionOpen: (id: SessionPanelOpenSectionId) => boolean;
  toggleSection: (id: SessionPanelOpenSectionId) => void;
}

/** Radix portals render outside the panel root; a click in one is not "outside". */
const PORTAL_SELECTOR = '[data-radix-popper-content-wrapper],[role="menu"],[role="dialog"]';

/** An open dialog owns Escape; the non-modal overlay must not swallow it. */
function hasOpenDialogOutside(root: HTMLElement | null): boolean {
  const dialogs = document.querySelectorAll(
    '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]',
  );
  for (const dialog of dialogs) {
    if (!root?.contains(dialog)) return true;
  }
  return false;
}

export function useSessionPanelState(columnId: PanelColumnId = 'main'): SessionPanelState {
  const [hostEl, setHostEl] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const overlayOpen = usePanelControl(selectOverlayOpen(columnId));
  const setOverlay = usePanelControl((s) => s.setOverlayOpen);
  const setFits = usePanelControl((s) => s.setFits);
  const toggleInStore = usePanelControl((s) => s.togglePanel);
  const setOverlayOpen = useCallback((open: boolean) => setOverlay(columnId, open), [setOverlay, columnId]);

  const panelOpen = usePanelOpen(columnId);
  const setPanelOpen = usePanelControl((s) => s.setPanelOpen);
  const sections = useUiPrefs((s) => s.sessionPanelSections);
  const toggleSessionPanelSection = useUiPrefs((s) => s.toggleSessionPanelSection);

  // Keyed on the host ELEMENT, so the observer attaches whenever the row
  // (re)mounts — including the cold-boot case where the initializing branch
  // rendered first and the row only exists on a later commit.
  useEffect(() => {
    if (!hostEl) return;
    setSurfaceWidth(hostEl.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSurfaceWidth(entry.contentRect.width);
    });
    observer.observe(hostEl);
    return () => observer.disconnect();
  }, [hostEl]);

  const gutterFits = columnFitsPanel(surfaceWidth);
  const mode = derivePanelMode({ columnWidth: surfaceWidth, open: panelOpen, overlayOpen });

  // The title bar's toggle cannot measure this column; it reads the verdict
  // published here. Unmeasured (width 0) reads as fitting — see the store.
  useEffect(() => {
    if (surfaceWidth > 0) setFits(columnId, gutterFits);
  }, [columnId, gutterFits, surfaceWidth, setFits]);

  // A floated panel has no reason to survive the column widening back up: once
  // there is room, it docks.
  useEffect(() => {
    if (overlayOpen && gutterFits) setOverlayOpen(false);
  }, [gutterFits, overlayOpen, setOverlayOpen]);

  // The panel is on by default whenever there is room: the first time the
  // column fits after boot, it opens — even over a persisted close from a
  // previous run. Closing it stays honoured within the run (the ref arms once).
  const bootOpened = useRef(false);
  useEffect(() => {
    if (bootOpened.current || !gutterFits) return;
    bootOpened.current = true;
    setPanelOpen(columnId, true);
  }, [gutterFits, setPanelOpen, columnId]);

  // Light dismiss — Escape, or a pointer outside both the panel and any portal.
  useEffect(() => {
    if (mode !== 'overlay') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (hasOpenDialogOutside(rootRef.current)) return;
      setOverlayOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (rootRef.current?.contains(node)) return;
      const element = node instanceof Element ? node : node.parentElement;
      if (element?.closest(PORTAL_SELECTOR)) return;
      setOverlayOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [mode, setOverlayOpen]);

  const hostRef = useCallback((el: HTMLElement | null) => setHostEl(el), []);

  const isPanelOpen = useCallback(() => panelOpen, [panelOpen]);

  const isPanelVisible = useCallback(() => (mode === 'inline' || mode === 'overlay') && panelOpen, [mode, panelOpen]);

  // The float-when-narrow rule lives in the store so the column's toggle and
  // this hook can never disagree about it.
  const togglePanel = useCallback(
    () => toggleInStore(columnId, columnFitsPanel(surfaceWidth)),
    [toggleInStore, columnId, surfaceWidth],
  );

  return {
    hostRef,
    rootRef,
    surfaceWidth,
    mode,
    isPanelOpen,
    isPanelVisible,
    togglePanel,
    isSectionOpen: (id) => isSessionPanelSectionOpen(sections, id),
    toggleSection: toggleSessionPanelSection,
  };
}
