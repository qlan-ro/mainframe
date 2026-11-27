/**
 * The app's older-page rule (`EarlierMessages` `useOlderPageGesture`), shared by the manual mode and
 * `S-top`: an upward gesture (wheel up, touch, up key) arms a load, which fires once the reader is
 * within one viewport of the top. A window shorter than the viewport has no scroll events, so the
 * gesture itself must be able to fire it. The page lands after a daemon-like delay (`params.pageDelay`
 * ms, each load varying ±30%), while the reader keeps scrolling.
 */
import { frame, type Recorder } from '../probe';
import { params } from '../params';
import { store } from '../store';

export interface OlderPageLoader {
  /** Requests so far, and the time each page landed (`performance.now()`). */
  loads: number;
  landedAt: number[];
  stop: () => void;
}

/** Frames a load stays "busy" after its page lands (one load in flight, as in the app). */
const SETTLE_FRAMES = 14;

export function installOlderPageLoader(
  el: HTMLElement,
  hooks: { onRequest?: () => void; onLanded?: (messages: number) => void } = {},
): OlderPageLoader {
  let armed = false;
  let busy = false;
  const loader: OlderPageLoader = { loads: 0, landedAt: [], stop: () => {} };
  const load = async () => {
    loader.loads++;
    hooks.onRequest?.();
    // The app's boundary row shows its loading state while the page is in flight.
    if (params.variant === 'app') store.set({ loading: true });
    if (params.pageDelay > 0) {
      const wait = params.pageDelay * (0.7 + Math.random() * 0.6);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const messages = store.prependPage();
    loader.landedAt.push(performance.now());
    hooks.onLanded?.(messages);
    for (let i = 0; i < SETTLE_FRAMES; i++) await frame();
    busy = false;
  };
  const check = () => {
    if (!armed || busy || !store.hasMore() || el.scrollTop > el.clientHeight) return;
    armed = false;
    busy = true;
    void load();
  };
  const gesture = (event: Event) => {
    if (event instanceof WheelEvent && event.deltaY >= 0) return;
    if (event instanceof KeyboardEvent && !['ArrowUp', 'PageUp', 'Home'].includes(event.key)) return;
    armed = true;
    check();
  };
  const names = ['wheel', 'touchmove', 'keydown'];
  for (const name of names) el.addEventListener(name, gesture, { passive: true });
  el.addEventListener('scroll', check, { passive: true });
  loader.stop = () => {
    for (const name of names) el.removeEventListener(name, gesture);
    el.removeEventListener('scroll', check);
  };
  return loader;
}

/** The block under the viewport centre; a short window may leave it empty, so fall back to the newest visible row. */
export function pickReaderAnchor(recorder: Recorder, el: HTMLElement) {
  const box = el.getBoundingClientRect();
  const centre = document.elementFromPoint(box.left + el.clientWidth / 2, box.top + el.clientHeight / 2);
  const rows = el.querySelectorAll('[data-message-id]');
  recorder.anchor(
    centre && el.contains(centre) && centre.closest('[data-message-id]') ? centre : rows[rows.length - 1]!,
  );
}
