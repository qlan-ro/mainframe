/**
 * R-read (#521): the reader scrolls up to read while a Claude-shaped reply streams (`live-turn.ts`), then holds
 * still. Their block must not move by itself: every frame's movement with no wheel input in it or the frames
 * before it is scored (`unexplained` in `frame-log.ts`). `endAt` ends the run while they read, so the turn
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
    await wheel(step);
    await sleep(16);
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
  return {
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
