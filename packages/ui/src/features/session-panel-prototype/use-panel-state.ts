/**
 * THROWAWAY PROTOTYPE — the one piece all three variants share: the
 * width-driven state machine (inline / rail-only / overlay), which sections are
 * expanded, and the section-scroll registry. No layout, no markup, no
 * persistence — remounting resets everything by design.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { SECTION_ORDER, type SectionId } from './stub-data';

/** Chat-surface width at which the panel is wide enough to sit inline. */
export const INLINE_MIN_WIDTH = 1000;

export type PanelMode = 'inline' | 'rail' | 'overlay';

export interface FocusRequest {
  id: SectionId;
  /** Bumped on every rail click so re-clicking the same section scrolls again. */
  seq: number;
}

export interface SessionPanelState {
  /** Goes on the variant's root element; its parent is measured for the width. */
  rootRef: RefObject<HTMLDivElement | null>;
  surfaceWidth: number;
  isWide: boolean;
  mode: PanelMode;
  focusRequest: FocusRequest | null;
  isSectionOpen: (id: SectionId) => boolean;
  toggleSection: (id: SectionId) => void;
  /** Rail icon click: reveal + scroll to a section, floating the panel when rail-only. */
  selectSection: (id: SectionId) => void;
  /** The rail's bottom toggle and the panel header's collapse control. */
  toggleCollapsed: () => void;
  closeOverlay: () => void;
  /** Callback ref a variant hangs on each section element so scroll-to works. */
  registerSection: (id: SectionId) => (el: HTMLElement | null) => void;
}

const FIRST_SECTION: SectionId = SECTION_ORDER[0] ?? 'session';

export interface SessionPanelOptions {
  /** Sections expanded on mount. Defaults to all of them. */
  initialOpenSections?: readonly SectionId[];
}

export function useSessionPanelState(options: SessionPanelOptions = {}): SessionPanelState {
  const { initialOpenSections = SECTION_ORDER } = options;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sectionEls = useRef(new Map<SectionId, HTMLElement>());
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  // Seeded once: later changes to the option don't reopen what the user closed.
  const [openSections, setOpenSections] = useState<ReadonlySet<SectionId>>(() => new Set(initialOpenSections));
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  // The surface width is the row we sit in, not our own box — measure the parent.
  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host) return;
    setSurfaceWidth(host.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSurfaceWidth(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const isWide = surfaceWidth >= INLINE_MIN_WIDTH;
  const inline = isWide && !collapsed;
  const mode: PanelMode = inline ? 'inline' : overlayOpen ? 'overlay' : 'rail';

  // A floated panel has no reason to survive the surface growing back to inline.
  useEffect(() => {
    if (inline && overlayOpen) setOverlayOpen(false);
  }, [inline, overlayOpen]);

  // Light dismiss — Escape or a pointer outside the rail+panel root.
  useEffect(() => {
    if (mode !== 'overlay') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverlayOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) setOverlayOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [mode]);

  // Scroll the requested section into view once the variant has rendered it.
  useEffect(() => {
    if (!focusRequest) return;
    sectionEls.current.get(focusRequest.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focusRequest, mode]);

  const isSectionOpen = useCallback((id: SectionId) => openSections.has(id), [openSections]);

  const toggleSection = useCallback((id: SectionId) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectSection = useCallback(
    (id: SectionId) => {
      // Clicking the section a floated panel is already showing closes it again.
      if (mode === 'overlay' && focusRequest?.id === id) {
        setOverlayOpen(false);
        return;
      }
      setOpenSections((current) => (current.has(id) ? current : new Set(current).add(id)));
      setFocusRequest((current) => ({ id, seq: (current?.seq ?? 0) + 1 }));
      if (!inline) setOverlayOpen(true);
    },
    [focusRequest, inline, mode],
  );

  const toggleCollapsed = useCallback(() => {
    if (inline) {
      setCollapsed(true);
      return;
    }
    if (isWide) {
      setCollapsed(false);
      setOverlayOpen(false);
      return;
    }
    // Too narrow to sit inline: the expand affordance floats the panel instead.
    setOverlayOpen((open) => !open);
    setFocusRequest((current) => ({ id: current?.id ?? FIRST_SECTION, seq: (current?.seq ?? 0) + 1 }));
  }, [inline, isWide]);

  const closeOverlay = useCallback(() => setOverlayOpen(false), []);

  const registerSection = useCallback(
    (id: SectionId) => (el: HTMLElement | null) => {
      if (el) sectionEls.current.set(id, el);
      else sectionEls.current.delete(id);
    },
    [],
  );

  return useMemo(
    () => ({
      rootRef,
      surfaceWidth,
      isWide,
      mode,
      focusRequest,
      isSectionOpen,
      toggleSection,
      selectSection,
      toggleCollapsed,
      closeOverlay,
      registerSection,
    }),
    [
      surfaceWidth,
      isWide,
      mode,
      focusRequest,
      isSectionOpen,
      toggleSection,
      selectSection,
      toggleCollapsed,
      closeOverlay,
      registerSection,
    ],
  );
}
