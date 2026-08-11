/**
 * use-session-panel-state — the session panel's state machine: which mode the
 * stack is in (inline / rail / overlay) and which panels are open in it.
 *
 * Open-state is NOT held here. `store/ui-prefs.ts` is its single owner, so an
 * open panel survives a remount and a session switch; this hook only reads and
 * writes through. A rail click therefore writes a persisted preference —
 * intended, so the panels you work with are still open next session.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  useUiPrefs,
  isSessionPanelOpen,
  isSessionPanelSectionOpen,
  type SessionPanelId,
  type SessionPanelOpenSectionId,
} from '@/store/ui-prefs';
import { derivePanelMode, gutterFitsPanel, type PanelMode } from './panel-mode';

export interface SessionPanelState {
  /** Goes on the chat surface's horizontal row — the FULL width, including the
   *  part the panel floats over, since the mode follows the gutter that width
   *  leaves beside the centred transcript. Explicit, rather than the panel
   *  root's `parentElement`, so a split surface measures the row it shrinks.
   *
   *  A CALLBACK ref backed by state, not a RefObject, and that is load-bearing:
   *  on a cold boot the chat surface shows its initializing branch first, so the
   *  row does not exist when this hook's effects first run. A `[]`-deps effect
   *  reading a RefObject box measured `null` once and never retried — the panel
   *  stayed `hidden` forever in the packaged app, where the daemon spawn always
   *  loses that race (dev servers boot fast enough to always win it). */
  hostRef: (el: HTMLElement | null) => void;
  /** Goes on the panel + rail root; light dismiss treats it as "inside". */
  rootRef: RefObject<HTMLDivElement | null>;
  surfaceWidth: number;
  mode: PanelMode;
  isPanelOpen: (id: SessionPanelId) => boolean;
  /** Open AND showing — false for an open panel whose stack is not floated on a
   *  short gutter. The rail's engaged state follows this, not the raw bit. */
  isPanelVisible: (id: SessionPanelId) => boolean;
  /** Rail toggle. Opening on a short gutter also floats the stack over the
   *  transcript — the click asked to see the panel, not just to arm a bit. */
  togglePanel: (id: SessionPanelId) => void;
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

export function useSessionPanelState(): SessionPanelState {
  const [hostEl, setHostEl] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);

  const openPanels = useUiPrefs((s) => s.sessionPanelOpen);
  const toggleSessionPanel = useUiPrefs((s) => s.toggleSessionPanel);
  const openSessionPanel = useUiPrefs((s) => s.openSessionPanel);
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

  const gutterFits = gutterFitsPanel(surfaceWidth);
  const mode = derivePanelMode({ surfaceWidth, overlayOpen });

  // A floated stack has no reason to survive the gutter opening back up: once
  // there is room, the panels belong in it.
  useEffect(() => {
    if (overlayOpen && gutterFits) setOverlayOpen(false);
  }, [gutterFits, overlayOpen]);

  // The session card is on by default whenever there is room: the first time
  // the gutter fits after boot, it opens — even over a persisted close from a
  // previous run. Closing it stays honoured within the run (the ref arms once).
  const bootOpened = useRef(false);
  useEffect(() => {
    if (bootOpened.current || !gutterFits) return;
    bootOpened.current = true;
    openSessionPanel('session');
  }, [gutterFits, openSessionPanel]);

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
  }, [mode]);

  const hostRef = useCallback((el: HTMLElement | null) => setHostEl(el), []);

  const isPanelOpen = useCallback((id: SessionPanelId) => isSessionPanelOpen(openPanels, id), [openPanels]);

  const isPanelVisible = useCallback(
    (id: SessionPanelId) => (mode === 'inline' || mode === 'overlay') && isSessionPanelOpen(openPanels, id),
    [mode, openPanels],
  );

  const togglePanel = useCallback(
    (id: SessionPanelId) => {
      const open = isSessionPanelOpen(useUiPrefs.getState().sessionPanelOpen, id);
      const gutterFits = gutterFitsPanel(surfaceWidth);
      // Open but not showing (short gutter, stack not floated): the click asked
      // to SEE the panel, so float the stack rather than silently closing it.
      if (open && !gutterFits && !overlayOpen) {
        setOverlayOpen(true);
        return;
      }
      toggleSessionPanel(id);
      if (!open && !gutterFits) setOverlayOpen(true);
    },
    [toggleSessionPanel, surfaceWidth, overlayOpen],
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
