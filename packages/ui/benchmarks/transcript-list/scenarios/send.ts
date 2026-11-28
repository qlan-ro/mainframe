/**
 * R-send (#519): the reader is at the tail and sends. In one task, as the app does it: the composer clears (its
 * draft was `lines` tall, so the viewport above grows), the prompt row lands with the run flag, and the owner is
 * told the user sent (`announceUserSend` → `pinToBottom`). Thinking and the first content stream in `think` ms
 * later (`live-turn.ts`). `previous` runs a turn first and ends it `endBefore` ms before the send (negative: after
 * it), so its fold lands near the send. Scored from the send: the largest gap to the bottom, frames not following,
 * and every frame where the position moved up with no wheel input.
 */
import { controls } from '../controls';
import { FrameLog } from '../frame-log';
import { round, sleep } from '../probe';
import { startLiveTurn } from '../live-turn';
import { store } from '../store';
import { ready } from './setup';

export async function send({
  lines = 6,
  think = 600,
  watch = 4,
  previous = 0,
  endBefore = 300,
  forceLayout = false,
  verbose = false,
}: {
  lines?: number;
  think?: number;
  watch?: number;
  previous?: number;
  endBefore?: number;
  /** Read layout after each commit, in the same task, as other parts of the app do (`live-turn.ts`). */
  forceLayout?: boolean;
  verbose?: boolean;
}) {
  await ready(1500);
  const log = new FrameLog();
  log.start();
  const field = document.querySelector<HTMLTextAreaElement>('[data-rig-input]');
  if (field) controls.setDraft?.(Array.from({ length: lines }, (_, i) => `Line ${i + 1} of the draft.`).join('\n'));
  else store.set({ composerLines: lines });
  await sleep(300);
  let prior: ReturnType<typeof startLiveTurn> | null = null;
  if (previous > 0) {
    prior = startLiveTurn({ steps: 200, tag: 'prev', forceLayout });
    log.mark('previous');
    await sleep(previous * 1000 - Math.max(0, endBefore));
    if (endBefore >= 0) {
      log.mark('previous-end');
      await prior.end();
      await sleep(endBefore);
    }
  }
  const from = log.records.length;
  log.mark('send');
  if (field) {
    // Enter in the real field: it submits its form, the runtime's `onNew` lands the prompt and re-pins.
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  } else {
    store.set({ composerLines: 1 });
    store.sendUser(4242, 'Now make the same change in the other package.');
    controls.jump();
  }
  if (forceLayout) queueMicrotask(() => queueMicrotask(() => void document.body.offsetHeight));
  if (prior && endBefore < 0) {
    await sleep(-endBefore);
    log.mark('previous-end');
    await prior.end();
  }
  await sleep(think);
  const turn = startLiveTurn({ steps: 200, send: false, tag: 'next', forceLayout });
  log.mark('first-content');
  await sleep(watch * 1000);
  turn.pause();
  await sleep(200);
  const records = log.stop().slice(from);
  const gaps = records.map((r) => r.scrollHeight - r.clientHeight - r.scrollTop);
  const upMoves = records
    .map((r, i) => ({ r, i, step: i ? r.scrollTop - records[i - 1]!.scrollTop : 0 }))
    .filter(({ r, step }) => step < -1 && r.wheel === 0);
  return {
    worstGap: round(Math.max(...gaps)),
    finalGap: round(gaps.at(-1) ?? NaN),
    notFollowing: records.filter((r) => r.following === false).length,
    firstNotFollowing: records.findIndex((r) => r.following === false),
    upMoves: upMoves.length,
    upEvents: upMoves.slice(0, verbose ? 100 : 6).map(({ r, i, step }) => ({
      i,
      step: round(step),
      gap: round(gaps[i]!),
      following: r.following,
      writes: r.writes,
      marks: r.marks,
    })),
    trace: verbose
      ? records.map((r, i) => ({
          i,
          t: round(r.t),
          st: round(r.scrollTop),
          sh: r.scrollHeight,
          ch: r.clientHeight,
          gap: round(gaps[i]!),
          f: r.following,
          wr: r.writes.length
            ? r.writes.map((w) => `${w.via} ${round(w.from)}→${round(w.to)} ${w.caller.split(' < ').at(-1)}`)
            : undefined,
          m: r.marks.length ? r.marks : undefined,
          rows: r.rows,
        }))
      : undefined,
  };
}
