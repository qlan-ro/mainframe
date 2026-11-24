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
import { scrollerAt, scrolls, scrollsAnyAxis } from './scroller';
import { createThumb, type Thumb } from './thumb';

/** How long a thumb stays after the last scroll, and after the pointer leaves. */
const HIDE_AFTER_MS = 900;
/** Catches moves no event reports (animated panels, unmounts, newly opened dialogs) and looks again at what covers a thumb. */
const RECHECK_MS = 250;

const AXES: Axis[] = ['y', 'x'];

class ScrollerBars {
  private readonly thumbs = new Map<Axis, Thumb>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  visible = false;

  constructor(
    readonly scroller: Element,
    private readonly isHovered: () => boolean,
  ) {}

  place(refresh: boolean): void {
    for (const thumb of this.thumbs.values()) thumb.place(refresh);
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
  let frame = 0;

  const barsFor = (scroller: Element): ScrollerBars => {
    let entry = bars.get(scroller);
    if (!entry) {
      entry = new ScrollerBars(scroller, () => hovered === scroller);
      bars.set(scroller, entry);
    }
    return entry;
  };

  const placeVisible = (refresh: boolean): void => {
    for (const [scroller, entry] of bars) {
      if (!scroller.isConnected) {
        entry.dispose();
        bars.delete(scroller);
        if (hovered === scroller) hovered = null;
      } else if (entry.visible) entry.place(refresh);
    }
  };
  let refreshNext = false;
  const schedulePlace = (refresh: boolean): void => {
    refreshNext ||= refresh;
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        placeVisible(refreshNext);
        refreshNext = false;
      });
  };
  // A resize moves what covers a thumb; a scroll moves the thumb, and what covers it is looked at again soon enough.
  const onResize = (): void => schedulePlace(true);

  const hover = (scroller: Element | null): void => {
    if (scroller === hovered) return;
    const previous = hovered;
    hovered = scroller;
    if (previous) bars.get(previous)?.hideSoon();
    if (scroller) barsFor(scroller).show();
  };

  const onScroll = (event: Event): void => {
    const scroller = event.target;
    // A scroll moves nested scrollers too, so every visible thumb is re-placed.
    schedulePlace(false);
    if (!(scroller instanceof Element) || !scrollsAnyAxis(scroller)) return;
    const entry = barsFor(scroller);
    if (!entry.visible) entry.show();
    entry.hideSoon();
  };
  const onPointerOver = (event: PointerEvent): void => {
    if (event.target === lastTarget || !(event.target instanceof Element)) return;
    lastTarget = event.target;
    if (!event.target.closest('.mf-scrollbar')) hover(scrollerAt(event.target));
  };
  const onPointerLeave = (): void => {
    lastTarget = null;
    hover(null);
  };

  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('pointerover', onPointerOver, { passive: true });
  document.documentElement.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('resize', onResize);
  const recheck = setInterval(() => placeVisible(true), RECHECK_MS);

  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('pointerover', onPointerOver);
    document.documentElement.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('resize', onResize);
    clearInterval(recheck);
    cancelAnimationFrame(frame);
    for (const entry of bars.values()) entry.dispose();
    bars.clear();
  };
}
