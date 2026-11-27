/**
 * P5 and the mount half of P6, watched from before the first render. Every frame
 * records whether the rows are really visible (`checkVisibility` with the visibility
 * and opacity properties: a list that is `visibility: hidden` shows nothing), so a
 * hidden frame is told apart from a visible one that is at the wrong place.
 *
 *   rowsInDomMs     first frame with message rows in the DOM
 *   firstVisibleMs  first frame whose rows are really visible (what the user first sees)
 *   mountMs         first frame showing the last row (the tail)
 *   hiddenFrames    frames with rows in the DOM but none visible
 *   wrongFrames     visible frames before the tail shows
 *   lastRowOnFirstFrame, firstFrameGap, firstFrameScrollTop: state on the first visible frame
 *   newestMoved     how far the newest row's bottom edge moved against the viewport's bottom edge from the
 *                   first visible frame on (until 40 frames after the tail first shows): a short tail that
 *                   paints at the top and then jumps to the bottom moves by the empty space under it
 */
import { controls } from '../controls';
import { gapOf, round } from '../probe';
import { store } from '../store';

export interface BootResult {
  firstRowsFrame: number;
  firstVisibleFrame: number;
  lastRowOnFirstFrame: boolean;
  hiddenFrames: number;
  wrongFrames: number;
  rowsInDomMs: number;
  firstVisibleMs: number;
  mountMs: number;
  firstFrameScrollTop: number;
  firstFrameGap: number;
  newestMoved: number;
}

const SHOWN = { visibilityProperty: true, opacityProperty: true } as CheckVisibilityOptions;

function inView(row: HTMLElement | null, el: HTMLElement) {
  if (!row || !row.checkVisibility(SHOWN)) return false;
  const box = row.getBoundingClientRect();
  const view = el.getBoundingClientRect();
  return box.bottom > view.top && box.top < view.bottom && box.height > 0;
}

export function watchBoot(start: number): Promise<BootResult> {
  return new Promise((resolve) => {
    let frame = 0;
    const result: BootResult = {
      firstRowsFrame: -1,
      firstVisibleFrame: -1,
      lastRowOnFirstFrame: false,
      hiddenFrames: 0,
      wrongFrames: 0,
      rowsInDomMs: NaN,
      firstVisibleMs: NaN,
      mountMs: NaN,
      firstFrameScrollTop: NaN,
      firstFrameGap: NaN,
      newestMoved: 0,
    };
    let settle = -1;
    let lowest = Infinity;
    let highest = -Infinity;
    const tick = () => {
      frame++;
      const now = round(performance.now() - start);
      const el = controls.viewport ?? document.querySelector<HTMLElement>('[data-rig-viewport]');
      const rows = [...(el?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])];
      if (el && rows.length) {
        if (result.firstRowsFrame < 0) Object.assign(result, { firstRowsFrame: frame, rowsInDomMs: now });
        const lastId = store.get().messages.at(-1)?.id;
        const last = lastId ? (rows.find((r) => r.dataset.messageId === lastId) ?? null) : null;
        const tailShown = inView(last, el);
        // elementFromPoint skips `visibility: hidden` content: a row under the viewport centre is on screen.
        const box = el.getBoundingClientRect();
        const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        const anyShown = tailShown || Boolean(centre?.closest('[data-message-id]'));
        if (anyShown && result.firstVisibleFrame < 0)
          Object.assign(result, {
            firstVisibleFrame: frame,
            firstVisibleMs: now,
            lastRowOnFirstFrame: tailShown,
            firstFrameScrollTop: round(el.scrollTop),
            firstFrameGap: round(gapOf(el)),
          });
        if (anyShown && last) {
          const offset = last.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
          lowest = Math.min(lowest, offset);
          highest = Math.max(highest, offset);
          result.newestMoved = round(highest - lowest);
        }
        if (tailShown && settle < 0) {
          result.mountMs = now;
          settle = 40;
        }
        if (settle >= 0 && --settle < 0) {
          resolve(result);
          return;
        }
        if (!tailShown) {
          if (anyShown) result.wrongFrames++;
          else result.hiddenFrames++;
        }
      }
      if (frame < 600) requestAnimationFrame(tick);
      else resolve(result);
    };
    requestAnimationFrame(tick);
  });
}
