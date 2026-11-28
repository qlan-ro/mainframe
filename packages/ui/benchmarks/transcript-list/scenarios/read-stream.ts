/**
 * R-read (#521): the reader scrolls up to read while a Claude-shaped reply streams (`live-turn.ts`), then holds
 * still. From their first upward wheel delta, follow must stay off and the view must not return to the bottom by
 * itself (`followingAfterFirstUp`, `backToBottom`); once they hold still, their block must not move: every frame's
 * movement with no wheel input in it or the frames before it is scored (`unexplained` in `frame-log.ts`). `endAt` ends the run while they read, so the turn
 * folds under them; `nudges` makes them scroll a little every two seconds, as a reader does.
 */
import { FrameLog, unexplained } from '../frame-log';
import { wheel } from '../input';
import { frames, round, sleep } from '../probe';
import { params } from '../params';
import { store } from '../store';
import { startLiveTurn } from '../live-turn';
import { ready } from './setup';

export async function readStream({
  lead = 5,
  up = 1200,
  read = 10,
  endAt = -1,
  nudges = 0,
  step = -100,
  parkAt = -1,
  pages = 0,
  forceLayout = false,
  down = 0,
  drag = false,
  verbose = false,
}: {
  lead?: number;
  up?: number;
  read?: number;
  endAt?: number;
  nudges?: number;
  step?: number;
  /** After the wheel, park at this scrollTop (a reader near the top of the loaded window). */
  parkAt?: number;
  /** Older pages that land above the reader while they read, one every two seconds. */
  pages?: number;
  /** Read layout after each commit, in the same task (`live-turn.ts`). */
  forceLayout?: boolean;
  /** After the wheel up, one wheel back down by this much (a reader settling on a line). */
  down?: number;
  /** Scroll up with no wheel input, a step per frame, as a text selection dragged above the viewport does. */
  drag?: boolean;
  verbose?: boolean;
}) {
  await ready(1500);
  const log = new FrameLog();
  log.start();
  const turn = startLiveTurn({ steps: 200, forceLayout });
  log.mark('send');
  await sleep(lead * 1000);
  log.mark('wheel-up');
  for (let moved = 0; moved < up; moved += Math.abs(step)) {
    if (drag) {
      log.el.scrollBy({ top: step, behavior: 'instant' });
      await frames(1);
    } else {
      await wheel(step);
      await sleep(16);
    }
  }
  if (parkAt >= 0) log.el.scrollTop = parkAt;
  if (down > 0) {
    await sleep(200);
    await wheel(down);
  }
  await sleep(400);
  log.pickAnchor();
  log.mark('read');
  const readFrom = log.records.length;
  const started = performance.now();
  let ended = false;
  let nudged = 0;
  let landed = 0;
  while (performance.now() - started < read * 1000) {
    await sleep(100);
    const elapsed = (performance.now() - started) / 1000;
    if (!ended && endAt >= 0 && elapsed >= endAt) {
      ended = true;
      log.mark('end');
      await turn.end();
    }
    if (landed < pages && elapsed >= landed * 2 + 1) {
      landed++;
      if (params.variant === 'app') store.set({ loading: true });
      await frames(3);
      log.mark('page');
      store.prependPage();
    }
    if (nudged < nudges && elapsed >= (nudged + 1) * 2) {
      nudged++;
      await wheel(nudged % 2 ? -40 : 40);
      await sleep(300);
      log.pickAnchor();
      log.mark('nudge');
    }
  }
  if (!ended) await turn.end();
  await sleep(300);
  const records = log.stop();
  const scored = unexplained(records, { from: readFrom });
  const reading = records.slice(readFrom);
  // From the reader's first upward delta (a wheel event, or for a drag the first frame that moved up): their scroll must never be undone. Follow stays off (two frames for the
  // release to land), and the view never goes back to the bottom by itself.
  const upFrom = records.findIndex((r) => r.marks.includes('wheel-up'));
  const firstUp = records.findIndex((r, i) => i > upFrom && (r.wheel < 0 || r.scrollTop < records[i - 1]!.scrollTop));
  const afterUp = firstUp < 0 ? [] : records.slice(firstUp + 2);
  const gap = (r: (typeof records)[number]) => r.scrollHeight - r.clientHeight - r.scrollTop;
  let left = false;
  let backToBottom = 0;
  for (const r of afterUp) {
    if (gap(r) > 2) left = true;
    else if (left && r.wheel <= 0) backToBottom++;
  }
  return {
    followingAfterFirstUp: afterUp.filter((r) => r.following).length,
    backToBottom,
    worst: round(scored.worst),
    total: round(scored.total),
    jumps: scored.events.length,
    followingWhileReading: reading.filter((r) => r.following).length,
    anchorLost: reading.some((r) => r.anchorTop === null),
    stepsWritten: turn.steps(),
    frames: reading.length,
    events: scored.events.slice(0, verbose ? 200 : 12).map((e) => ({ ...e, t: round(e.t), step: round(e.step) })),
    trace: verbose
      ? records.map((r) => ({
          t: round(r.t),
          st: round(r.scrollTop),
          sh: r.scrollHeight,
          f: r.following,
          a: r.anchorTop === null ? null : round(r.anchorTop),
          w: r.wheel || undefined,
          wr: r.writes.length ? r.writes : undefined,
          m: r.marks.length ? r.marks : undefined,
          rows: r.rows,
        }))
      : undefined,
  };
}
