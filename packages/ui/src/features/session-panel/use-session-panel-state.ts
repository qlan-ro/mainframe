/**
 * use-session-panel-state — the session panel's state machine: which mode the
 * panel is in (inline / rail / overlay), which section a rail click is pointing
 * at, and the scroll registry that gets it there.
 *
 * Section open-state is NOT held here. `store/ui-prefs.ts` is its single owner,
 * so an expansion survives a remount and a session switch; this hook only reads
 * and writes through. A rail click therefore writes a persisted preference —
 * intended, so the section you navigated to is still open next session.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  useUiPrefs,
  isSessionPanelSectionOpen,
  type SessionPanelSectionId,
  type SessionPanelOpenSectionId,
} from '@/store/ui-prefs';
import { derivePanelMode, gutterFitsPanel, gutterFitsRail, type PanelMode } from './panel-mode';

export interface FocusRequest {
  id: SessionPanelSectionId;
  /** Bumped on every rail click so re-clicking the same section scrolls again. */
  seq: number;
}

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
  focusRequest: FocusRequest | null;
  isSectionOpen: (id: SessionPanelSectionId) => boolean;
  toggleSection: (id: SessionPanelOpenSectionId) => void;
  /** Rail icon click: expand + scroll to a section, and bring the card back —
   *  inline when the gutter fits it, floating over the transcript when it doesn't. */
  selectSection: (id: SessionPanelSectionId) => void;
  /** The inline card's own collapse control; persists, so it survives a reload. */
  collapsePanel: () => void;
  closeOverlay: () => void;
  /** Callback ref each section hangs on its element so scroll-to works. */
  registerSection: (id: SessionPanelSectionId) => (el: HTMLElement | null) => void;
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
  const sectionEls = useRef(new Map<SessionPanelSectionId, HTMLElement>());
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const sections = useUiPrefs((s) => s.sessionPanelSections);
  const toggleSessionPanelSection = useUiPrefs((s) => s.toggleSessionPanelSection);
  const expandSessionPanelSection = useUiPrefs((s) => s.expandSessionPanelSection);
  const userCollapsed = useUiPrefs((s) => s.sessionPanelCollapsed);
  const setUserCollapsed = useUiPrefs((s) => s.setSessionPanelCollapsed);

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
  const railFits = gutterFitsRail(surfaceWidth);
  const mode = derivePanelMode({ surfaceWidth, userCollapsed, overlayOpen });

  // A floated panel has no reason to survive the gutter opening back up: once
  // there is room, the card belongs in it (or in the rail, if the user said so).
  // And when the surface squeezes below even the rail, a stale overlay flag
  // would pop the card back the moment the rail returns — drop it there too.
  useEffect(() => {
    if (overlayOpen && (gutterFits || !railFits)) setOverlayOpen(false);
  }, [gutterFits, railFits, overlayOpen]);

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

  // Scroll the requested section into view once the panel has rendered it.
  useEffect(() => {
    if (!focusRequest) return;
    sectionEls.current.get(focusRequest.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focusRequest, mode]);

  const isSectionOpen = useCallback(
    (id: SessionPanelSectionId) => (id === 'summary' ? true : isSessionPanelSectionOpen(sections, id)),
    [sections],
  );

  const selectSection = useCallback(
    (id: SessionPanelSectionId) => {
      // Clicking the section a floated panel is already showing closes it again.
      if (mode === 'overlay' && focusRequest?.id === id) {
        setOverlayOpen(false);
        return;
      }
      if (id !== 'summary') expandSessionPanelSection(id);
      setFocusRequest((current) => ({ id, seq: (current?.seq ?? 0) + 1 }));
      if (mode === 'inline') return;
      // A rail click always means "show me this". Where the card goes depends on
      // room, not on how it got collapsed: a fitting gutter takes it back inline
      // (clearing the persisted collapse, the same on-the-record intent an
      // expanded section records), a short one floats it over the transcript.
      if (gutterFits) setUserCollapsed(false);
      else setOverlayOpen(true);
    },
    [expandSessionPanelSection, focusRequest, gutterFits, mode, setUserCollapsed],
  );

  const collapsePanel = useCallback(() => setUserCollapsed(true), [setUserCollapsed]);

  const closeOverlay = useCallback(() => setOverlayOpen(false), []);

  const registerSection = useCallback(
    (id: SessionPanelSectionId) => (el: HTMLElement | null) => {
      if (el) sectionEls.current.set(id, el);
      else sectionEls.current.delete(id);
    },
    [],
  );

  return useMemo(
    () => ({
      hostRef: setHostEl,
      rootRef,
      surfaceWidth,
      mode,
      focusRequest,
      isSectionOpen,
      toggleSection: toggleSessionPanelSection,
      selectSection,
      collapsePanel,
      closeOverlay,
      registerSection,
    }),
    [
      surfaceWidth,
      mode,
      focusRequest,
      isSectionOpen,
      toggleSessionPanelSection,
      selectSection,
      collapsePanel,
      closeOverlay,
      registerSection,
    ],
  );
}
