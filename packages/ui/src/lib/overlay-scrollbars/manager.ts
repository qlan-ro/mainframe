/**
 * The app's one scrollbar (S3 in design/redesign/DECISIONS.md).
 *
 * Native scrollbars are hidden in every engine (`styles/app.css`), because
 * WKWebView draws a grey track and takes 15 px from the content whenever macOS
 * shows scroll bars always. This manager draws an overlay thumb for the scroll
 * area under the pointer and for any area that is scrolling, so every container
 * in the app is covered, portals included, without wrapping it. xterm draws its
 * own (`features/terminal/terminal-cache.ts`).
 */
import type { Axis } from './geometry';
import { metricsOf, paddingBox, scrollerAt, scrolls, scrollsAnyAxis } from './scroller';
import { createThumb, type Thumb } from './thumb';

/** How long a thumb stays after the last scroll, and after the pointer leaves. */
const HIDE_AFTER_MS = 900;
/** Catches moves no event reports (animated panels, unmounts, newly opened dialogs) and looks again at what covers a thumb. */
const RECHECK_MS = 250;

const AXES: Axis[] = ['y', 'x'];

class ScrollerBars {
  private readonly thumbs = new Map<Axis, Thumb>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastGeometry = '';
  visible = false;

  constructor(
    readonly scroller: Element,
    private readonly isHovered: () => boolean,
  ) {}

  place(refresh: boolean): void {
    for (const thumb of this.thumbs.values()) thumb.place(refresh);
  }

  recheck(coverChanged: boolean): void {
    const geometry = JSON.stringify([paddingBox(this.scroller), ...AXES.map((axis) => metricsOf(this.scroller, axis))]);
    if (coverChanged || geometry !== this.lastGeometry) this.place(true);
    this.lastGeometry = geometry;
  }

  show(): void {
    clearTimeout(this.timer);
    for (const axis of AXES) {
      if (this.thumbs.has(axis) || !scrolls(this.scroller, axis)) continue;
      this.thumbs.set(
        axis,
        createThumb(this.scroller, axis, { onEnter: () => this.show(), onLeave: () => this.hideSoon() }),
      );
    }
    this.place(!this.visible);
    this.setVisible(true);
  }

  hideSoon(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const held = this.isHovered() || [...this.thumbs.values()].some((thumb) => thumb.isHeld());
      if (held) this.hideSoon();
      else this.setVisible(false);
    }, HIDE_AFTER_MS);
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    for (const thumb of this.thumbs.values()) thumb.setVisible(visible);
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const thumb of this.thumbs.values()) thumb.remove();
    this.thumbs.clear();
  }
}

/** Mounts the manager on `document`; returns its teardown. */
export function installOverlayScrollbars(): () => void {
  const bars = new Map<Element, ScrollerBars>();
  let hovered: Element | null = null;
  let lastTarget: EventTarget | null = null;
  let pendingHover: Element | undefined;
  let frame = 0;
  let paintTask: ReturnType<typeof setTimeout> | undefined;
  const pendingShows = new Set<Element>();
  const scrollIntent = new WeakMap<Element, number>();

  const barsFor = (scroller: Element): ScrollerBars => {
    let entry = bars.get(scroller);
    if (!entry) {
      entry = new ScrollerBars(scroller, () => hovered === scroller);
      bars.set(scroller, entry);
    }
    return entry;
  };

  const placeVisible = (refresh: boolean, periodic = false): void => {
    for (const [scroller, entry] of bars) {
      if (!scroller.isConnected) {
        entry.dispose();
        bars.delete(scroller);
        if (hovered === scroller) hovered = null;
      } else if (entry.visible) {
        if (periodic) entry.recheck(refresh);
        else entry.place(refresh);
      }
    }
  };
  let refreshNext = false;
  const schedulePlace = (refresh: boolean): void => {
    refreshNext ||= refresh;
    if (!frame && paintTask === undefined)
      frame = requestAnimationFrame(() => {
        frame = 0;
        paintTask = setTimeout(() => {
          paintTask = undefined;
          if (pendingHover) {
            hover(scrollerAt(pendingHover));
            pendingHover = undefined;
          }
          placeVisible(refreshNext);
          refreshNext = false;
          for (const scroller of pendingShows) {
            if (!scroller.isConnected || !scrollsAnyAxis(scroller)) continue;
            const entry = barsFor(scroller);
            if (!entry.visible) entry.show();
            entry.hideSoon();
          }
          pendingShows.clear();
        }, 0);
      });
  };
  // A resize moves what covers a thumb; a scroll moves the thumb, and what covers it is looked at again soon enough.
  const onResize = (): void => schedulePlace(true);

  const hover = (scroller: Element | null): void => {
    if (scroller === hovered) return;
    const previous = hovered;
    hovered = scroller;
    if (previous) bars.get(previous)?.hideSoon();
    if (scroller) pendingShows.add(scroller);
  };

  const scheduleShow = (scroller: Element): void => {
    pendingShows.add(scroller);
    schedulePlace(false);
  };

  const onScroll = (event: Event): void => {
    const scroller = event.target;
    if (bars.size) schedulePlace(false);
    if (!(scroller instanceof Element)) return;
    const entry = bars.get(scroller);
    if (entry?.visible) {
      entry.hideSoon();
      return;
    }
    if (scroller === hovered || (scrollIntent.get(scroller) ?? -Infinity) >= performance.now()) scheduleShow(scroller);
  };
  const onScrollInput = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    if (
      event instanceof KeyboardEvent &&
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
    )
      return;
    for (let target = scrollerAt(event.target); target; target = scrollerAt(target.parentElement))
      scrollIntent.set(target, performance.now() + HIDE_AFTER_MS);
  };
  const onPointerOver = (event: PointerEvent): void => {
    if (event.target === lastTarget || !(event.target instanceof Element)) return;
    lastTarget = event.target;
    if (event.target.closest('.mf-scrollbar')) return;
    pendingHover = event.target;
    schedulePlace(false);
  };
  const onPointerLeave = (): void => {
    lastTarget = null;
    pendingHover = undefined;
    hover(null);
  };

  const scrollInputs = ['wheel', 'touchmove', 'keydown'] as const;
  for (const type of scrollInputs) document.addEventListener(type, onScrollInput, { capture: true, passive: true });
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('pointerover', onPointerOver, { passive: true });
  document.documentElement.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('resize', onResize);
  let coverChanged = false;
  const invalidateCover = (): void => {
    coverChanged = true;
  };
  const observer = new MutationObserver((records) => {
    if (
      records.some(({ target, addedNodes, removedNodes }) => {
        if (target instanceof Element && target.closest('.mf-scrollbar')) return false;
        const changed = [...addedNodes, ...removedNodes];
        return !changed.length || changed.some((node) => !(node instanceof Element && node.matches('.mf-scrollbar')));
      })
    )
      invalidateCover();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-state'],
  });
  const coverEvents = ['transitionrun', 'transitionend', 'animationstart', 'animationend', 'pointerover'] as const;
  for (const type of coverEvents) document.addEventListener(type, invalidateCover, true);
  const recheck = setInterval(() => {
    const hasVisible = [...bars.values()].some((entry) => entry.visible);
    const animating =
      hasVisible && (document.getAnimations?.() ?? []).some((animation) => animation.playState === 'running');
    placeVisible(coverChanged || animating, true);
    coverChanged = false;
  }, RECHECK_MS);

  return () => {
    for (const type of scrollInputs) document.removeEventListener(type, onScrollInput, true);
    document.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('pointerover', onPointerOver);
    document.documentElement.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('resize', onResize);
    observer.disconnect();
    for (const type of coverEvents) document.removeEventListener(type, invalidateCover, true);
    clearInterval(recheck);
    cancelAnimationFrame(frame);
    clearTimeout(paintTask);
    pendingShows.clear();
    for (const entry of bars.values()) entry.dispose();
    bars.clear();
  };
}
