/**
 * P5 and the mount half of P6, watched from before the first render: the first
 * frame that has rows, whether it already shows the last row, and when the
 * last row is first visible.
 */
import { controls } from '../controls';
import { gapOf, round } from '../probe';
import { store } from '../store';

export interface BootResult {
  firstRowsFrame: number;
  lastRowOnFirstFrame: boolean;
  hiddenFrames: number;
  mountMs: number;
  firstFrameScrollTop: number;
  firstFrameGap: number;
}

function lastRowVisible(el: HTMLElement) {
  const id = store.get().messages.at(-1)?.id;
  const row = id ? el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`) : null;
  if (!row || !row.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions)) return false;
  const box = row.getBoundingClientRect();
  const view = el.getBoundingClientRect();
  return box.bottom > view.top && box.top < view.bottom && box.height > 0;
}

export function watchBoot(start: number): Promise<BootResult> {
  return new Promise((resolve) => {
    let frame = 0;
    let first = -1;
    let hidden = 0;
    const result = { lastRowOnFirstFrame: false, firstFrameScrollTop: NaN, firstFrameGap: NaN };
    const tick = () => {
      frame++;
      const el = controls.viewport ?? document.querySelector<HTMLElement>('[data-rig-viewport]');
      const rows = el?.querySelector('[data-message-id]');
      if (el && rows) {
        const visible = lastRowVisible(el);
        if (first < 0) {
          first = frame;
          Object.assign(result, {
            lastRowOnFirstFrame: visible,
            firstFrameScrollTop: round(el.scrollTop),
            firstFrameGap: round(gapOf(el)),
          });
        }
        if (visible) {
          resolve({
            ...result,
            firstRowsFrame: first,
            hiddenFrames: hidden,
            mountMs: round(performance.now() - start),
          });
          return;
        }
        hidden++;
      }
      if (frame < 600) requestAnimationFrame(tick);
      else resolve({ ...result, firstRowsFrame: first, hiddenFrames: hidden, mountMs: NaN });
    };
    requestAnimationFrame(tick);
  });
}
