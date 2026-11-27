/**
 * Scroll input. With a native bridge (Playwright's mouse, or the WKWebView
 * harness posting real `NSEvent` scroll-wheel events) the input takes the
 * engine's own wheel path, including WebKit's threaded scrolling. Without one
 * it dispatches a `WheelEvent` for listeners and scrolls by the same amount.
 */
import { viewport } from './probe';

type NativeCommand =
  { type: 'wheel'; dy: number; x: number; y: number } | { type: 'flick'; dy: number; x: number; y: number };
declare global {
  interface Window {
    __rigNative?: (command: NativeCommand) => Promise<unknown>;
  }
}

const centre = () => {
  const box = viewport().getBoundingClientRect();
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
};

export const nativeInput = () => typeof window.__rigNative === 'function';

export async function wheel(dy: number) {
  if (window.__rigNative) {
    await window.__rigNative({ type: 'wheel', dy, ...centre() });
    return;
  }
  const el = viewport();
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
  el.scrollBy(0, dy);
}

/** A trackpad flick with momentum. Only the WKWebView harness can produce one. */
export async function flick(dy: number) {
  if (!window.__rigNative) return false;
  await window.__rigNative({ type: 'flick', dy, ...centre() });
  return true;
}
