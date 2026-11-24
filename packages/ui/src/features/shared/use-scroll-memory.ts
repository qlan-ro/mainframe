import { useEffect } from 'react';

const positions = new Map<string, number>();

/** How long to wait for a remounted list to grow tall enough, in frames. */
const RESTORE_FRAMES = 30;

/**
 * Keeps a scroller's position across an unmount, for the app's lifetime.
 *
 * A windowed list mounts short and grows as it measures, so the position is put
 * back on the first frame that can hold it. Scrolling meanwhile wins.
 */
export function useScrollMemory(viewport: HTMLElement | null, key: string | undefined): void {
  useEffect(() => {
    if (viewport == null || key == null) return;
    const saved = positions.get(key) ?? 0;
    let frame = 0;
    let left = RESTORE_FRAMES;
    const stop = () => {
      cancelAnimationFrame(frame);
      left = 0;
    };
    const restore = () => {
      if (left <= 0) return;
      left -= 1;
      if (viewport.scrollHeight - viewport.clientHeight >= saved || left === 0) {
        left = 0;
        viewport.scrollTop = saved;
      } else {
        frame = requestAnimationFrame(restore);
      }
    };
    // The list fires its own scroll events while it measures; only a settled
    // position is worth keeping.
    const save = () => {
      if (left === 0) positions.set(key, viewport.scrollTop);
    };

    if (saved > 0) restore();
    else left = 0;
    viewport.addEventListener('scroll', save, { passive: true });
    viewport.addEventListener('wheel', stop, { passive: true });
    viewport.addEventListener('pointerdown', stop);
    return () => {
      stop();
      viewport.removeEventListener('scroll', save);
      viewport.removeEventListener('wheel', stop);
      viewport.removeEventListener('pointerdown', stop);
    };
  }, [viewport, key]);
}
