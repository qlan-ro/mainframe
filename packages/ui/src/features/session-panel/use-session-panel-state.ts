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
import { derivePanelMode, type PanelMode } from './panel-mode';

export interface FocusRequest {
  id: SessionPanelSectionId;
  /** Bumped on every rail click so re-clicking the same section scrolls again. */
  seq: number;
}

export interface SessionPanelState {
  /** Goes on the chat surface's horizontal row — the width the mode follows.
   *  Explicit, rather than the panel root's `parentElement`, so a split surface
   *  measures the row it actually shrinks. */
  hostRef: RefObject<HTMLElement | null>;
  /** Goes on the panel + rail root; light dismiss treats it as "inside". */
  rootRef: RefObject<HTMLDivElement | null>;
  surfaceWidth: number;
  mode: PanelMode;
  focusRequest: FocusRequest | null;
  isSectionOpen: (id: SessionPanelSectionId) => boolean;
  toggleSection: (id: SessionPanelOpenSectionId) => void;
  /** Rail icon click: expand + scroll to a section, floating the panel when rail-only. */
  selectSection: (id: SessionPanelSectionId) => void;
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
  const hostRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sectionEls = useRef(new Map<SessionPanelSectionId, HTMLElement>());
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const sections = useUiPrefs((s) => s.sessionPanelSections);
  const toggleSessionPanelSection = useUiPrefs((s) => s.toggleSessionPanelSection);
  const expandSessionPanelSection = useUiPrefs((s) => s.expandSessionPanelSection);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setSurfaceWidth(host.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSurfaceWidth(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const mode = derivePanelMode({ surfaceWidth, overlayOpen });

  // A floated panel has no reason to survive the surface growing back to inline.
  useEffect(() => {
    if (mode === 'inline' && overlayOpen) setOverlayOpen(false);
  }, [mode, overlayOpen]);

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
      if (mode !== 'inline') setOverlayOpen(true);
    },
    [expandSessionPanelSection, focusRequest, mode],
  );

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
      hostRef,
      rootRef,
      surfaceWidth,
      mode,
      focusRequest,
      isSectionOpen,
      toggleSection: toggleSessionPanelSection,
      selectSection,
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
      closeOverlay,
      registerSection,
    ],
  );
}
