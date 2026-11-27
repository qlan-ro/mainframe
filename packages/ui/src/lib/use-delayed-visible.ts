import { useEffect, useRef, useState } from 'react';

/** How long a loading indicator that has appeared stays: the chat-open spinner and the top of the plain list share it. */
export const LOADING_MIN_VISIBLE_MS = 300;

export interface DelayedVisibleOptions {
  /** How long `active` must hold before the indicator shows, so a fast load never flashes it. */
  delay?: number;
  /** Once shown, how long it stays, so a load finishing just after the delay does not flicker it. */
  minVisible?: number;
  /** A change of key (a chat switch) starts over: nothing shows from the last chat's timers. */
  resetKey?: string | null;
}

/**
 * Whether a loading indicator shows. It waits `delay` ms of continuous activity
 * before appearing and then stays at least `minVisible` ms. `delay: 0` shows at
 * once, and `minVisible` alone only holds an indicator already on screen.
 */
export function useDelayedVisible(
  active: boolean,
  { delay = 200, minVisible = 300, resetKey = null }: DelayedVisibleOptions = {},
): boolean {
  const [state, setState] = useState({ key: resetKey, visible: false });
  const shownAt = useRef(0);
  const visible = state.key === resetKey && state.visible;
  useEffect(() => {
    const show = () => {
      shownAt.current = performance.now();
      setState({ key: resetKey, visible: true });
    };
    if (active) {
      if (visible) return;
      if (delay <= 0) {
        show();
        return;
      }
      const timer = setTimeout(show, delay);
      return () => clearTimeout(timer);
    }
    if (!visible) return;
    const remaining = Math.max(0, minVisible - (performance.now() - shownAt.current));
    const timer = setTimeout(() => setState({ key: resetKey, visible: false }), remaining);
    return () => clearTimeout(timer);
  }, [active, visible, delay, minVisible, resetKey]);
  return active && delay <= 0 ? true : visible;
}
