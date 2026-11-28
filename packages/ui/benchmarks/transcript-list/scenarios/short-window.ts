/**
 * S-top: a chat whose first window is shorter than the screen or close to it (`window=2`, or
 * `shape=real`), so the reader reaches the top at once and an older page lands while they are still
 * scrolling at or near offset 0. The page arrives after a daemon-like delay (60 ms ±30%) while the
 * wheel keeps going. The reader keeps wheeling after each landing, so a later page may land at the top
 * again; each landing is scored on its own.
 *
 * Scoring, per landing. The anchor is the block under the viewport centre when the page is requested.
 * The baseline is the last frame before the landing shows (the first frame whose content height
 * changed). From there the wheel's own movement is removed: the expected offset of the anchor is its
 * baseline offset plus the net wheel travel, where a wheel event applied before the page extends the
 * content stops at the top of the old content (the browser discards what the top cannot take). The
 * residual is the gap between the measured and the expected offset over the next 20 frames. An anchor
 * that left the viewport is still a number; an unmounted one counts as lost (Infinity), never as a
 * missing sample. The distance to the bottom of the content is scored the same way. It needs no mounted
 * anchor, so it tells a virtualizer's unmounted anchor from a reader who lost their place.
 *
 * A wheel event and the frame whose sample shows its scroll can be a few frames apart (threaded
 * scrolling, a main-thread stall while the page mounts), and the lag differs per event. The model is
 * therefore a prefix: the browser has applied the first `m` events, `m` anywhere between "everything
 * that arrived more than four frames ago" and "everything up to one frame from now", and the best fit
 * is scored; so is the number of events applied before the landing shows. That forgives a jump no
 * larger than the wheel step in flight.
 */
import { Recorder, frames, round, sleep, viewport, type Sample } from '../probe';
import { flick, wheel } from '../input';
import { store } from '../store';
import { installOlderPageLoader, pickReaderAnchor } from './older-page';
import { park, ready } from './setup';

interface WheelRecord {
  t: number;
  dy: number;
}

const FRAME_MS = 16.7;
/** Frames scored after a landing shows. */
const WINDOW = 20;

const arrived = (events: WheelRecord[], t: number) => events.filter((e) => e.t <= t).length;

/** Residuals of one landing: per frame after `base`, for the anchor offset and the distance to the bottom. */
export function scoreLanding(all: Sample[], base: number, end: number, events: WheelRecord[], pageHeight: number) {
  const b = all[base]!;
  const top = Array<number>(end - base - 1).fill(Infinity);
  const gap = Array<number>(end - base - 1).fill(Infinity);
  const lo0 = arrived(events, b.t - 4 * FRAME_MS);
  const hi0 = arrived(events, b.t + FRAME_MS);
  const hiMax = arrived(events, all[end - 1]!.t + FRAME_MS);
  for (let a0 = lo0; a0 <= hi0; a0++)
    for (let landed = a0; landed <= Math.min(hiMax, a0 + 6); landed++) {
      // q is the scroll position the wheel alone would give: events before the landing stop at the old top, later ones at the top of the new page.
      const q = [b.scrollTop];
      for (let m = a0 + 1; m <= hiMax; m++) {
        const next = q[q.length - 1]! + events[m - 1]!.dy;
        // After the landing the content reaches `pageHeight` further up, and the reader can run out of it too.
        q.push(Math.max(m <= landed ? 0 : -pageHeight, next));
      }
      for (let j = base + 1; j < end; j++) {
        const s = all[j]!;
        const lo = Math.max(a0, arrived(events, s.t - 4 * FRAME_MS));
        const hi = Math.max(lo, arrived(events, s.t + FRAME_MS));
        for (let m = lo; m <= hi; m++) {
          const travel = -(q[m - a0]! - b.scrollTop);
          const at = j - base - 1;
          if (s.top !== null && b.top !== null) top[at] = Math.min(top[at]!, Math.abs(s.top - (b.top + travel)));
          gap[at] = Math.min(gap[at]!, Math.abs(s.gap - (b.gap + travel)));
        }
      }
    }
  return { top, gap };
}

export async function sTop({
  dy,
  steps = 40,
  flicks = 0,
  park: parkAtTop = false,
  debug = false,
}: {
  dy: number;
  steps?: number;
  flicks?: number;
  park?: boolean;
  debug?: boolean;
}) {
  await ready(1500);
  // `park`: the reader is at offset 0 before the first wheel (a wheel first releases a following owner).
  if (parkAtTop) await park(0);
  const el = viewport();
  const opening = { height: el.scrollHeight, viewport: el.clientHeight, scrollTop: el.scrollTop };
  const recorder = new Recorder(el);
  const events: WheelRecord[] = [];
  const record = (event: WheelEvent) => events.push({ t: performance.now(), dy: event.deltaY });
  el.addEventListener('wheel', record, { capture: true, passive: true });
  recorder.start();
  await frames(2);
  const requests: { index: number; t: number; scrollTop: number; height: number }[] = [];
  const pageMessages: number[] = [];
  const loader = installOlderPageLoader(el, {
    onRequest: () => {
      pickReaderAnchor(recorder, el);
      recorder.sample();
      requests.push({
        index: recorder.samples.length - 1,
        t: performance.now(),
        scrollTop: round(el.scrollTop),
        height: el.scrollHeight,
      });
    },
    onLanded: (messages) => pageMessages.push(messages),
  });
  if (flicks) {
    for (let i = 0; i < flicks; i++) if (!(await flick(dy))) return { skipped: 'no momentum input in this engine' };
  } else {
    for (let i = 0; i < steps; i++) {
      await wheel(dy);
      await sleep(50);
    }
  }
  await sleep(1200);
  loader.stop();
  el.removeEventListener('wheel', record, { capture: true });
  const all = recorder.stop();
  if (!requests.length) return { error: 'no page was requested', opening };

  const landings = loader.landedAt.map((called, k) => {
    // The frame the page shows in: the first one after the call whose content height changed.
    let shown = all.findIndex(
      (s, j) => j > requests[k]!.index && s.t >= called && Math.abs(s.height - all[j - 1]!.height) > 1,
    );
    if (shown < 1) shown = all.length - 1;
    const base = shown - 1;
    const next = requests[k + 1]?.index ?? all.length;
    const end = Math.min(shown + WINDOW, next, all.length);
    const { top, gap } = scoreLanding(
      all,
      base,
      Math.max(end, shown + 1),
      events,
      Math.max(0, all[shown]!.height - all[base]!.height),
    );
    const lost = all.slice(base + 1, end).filter((s) => s.top === null).length;
    const last = all[end - 1]!;
    return {
      pageHeight: round(all[shown]!.height - all[base]!.height),
      baseScrollTop: round(all[base]!.scrollTop),
      jump: Math.max(0, ...top),
      jumpEnd: top[top.length - 1] ?? 0,
      gapJump: Math.max(0, ...gap),
      gapEnd: gap[gap.length - 1] ?? 0,
      lost,
      pinned: last.scrollTop <= 1 && Math.max(0, ...top) > 2,
      debug: debug
        ? {
            base,
            shown,
            end,
            t0: round(all[base]!.t, 1),
            events: events
              .filter((e) => e.t > all[base]!.t - 150 && e.t < all[end - 1]!.t)
              .map((e) => [round(e.t - all[base]!.t, 1), e.dy]),
            series: all
              .slice(Math.max(0, base - 2), end)
              .map((s) => [
                round(s.t - all[base]!.t, 1),
                s.top === null ? null : round(s.top),
                round(s.scrollTop),
                round(s.height),
              ]),
            bad: top.flatMap((r, i) => (r > 2 ? [[i, round(r)]] : [])),
          }
        : undefined,
    };
  });
  const worst = (f: (l: (typeof landings)[number]) => number) => round(Math.max(0, ...landings.map(f)));
  return {
    mode: flicks ? 'flick' : 'wheel',
    park: parkAtTop,
    dy,
    opening: { viewports: round(opening.height / opening.viewport), scrollTop: round(opening.scrollTop) },
    loads: loader.loads,
    landed: landings.length,
    pageMessages,
    requestScrollTops: requests.map((r) => r.scrollTop),
    jump: worst((l) => l.jump),
    endResidual: worst((l) => l.jumpEnd),
    gapJump: worst((l) => l.gapJump),
    gapEnd: worst((l) => l.gapEnd),
    lostFrames: landings.reduce((acc, l) => acc + l.lost, 0),
    pinned: landings.filter((l) => l.pinned).length,
    pageHeights: landings.map((l) => l.pageHeight),
    perLanding: debug ? landings : undefined,
    endScrollTop: round(el.scrollTop),
    endHeight: el.scrollHeight,
    hasMore: store.hasMore(),
    wheelEvents: events.length,
    wheelSum: round(events.reduce((acc, e) => acc + e.dy, 0)),
    frames: all.length,
    // The longest gap between two frames: a page that mounts every row at once stalls the main thread here.
    longestFrameMs: round(Math.max(0, ...all.slice(1).map((s, i) => s.t - all[i]!.t))),
  };
}

/**
 * Control for the wheel ledger: the same input with no page landing, scored over every 20-frame window
 * of the run. The residual that remains is the ledger's own error (momentum events whose `deltaY` is not
 * exactly the scroll WebKit applied), the noise floor a flick's `S-top` residual has to be read against.
 */
export async function sNoise({ dy, steps = 40, flicks = 0 }: { dy: number; steps?: number; flicks?: number }) {
  await ready(1500);
  const el = viewport();
  await park(Math.round(el.scrollHeight * 0.8));
  const recorder = new Recorder(el);
  const events: WheelRecord[] = [];
  const record = (event: WheelEvent) => events.push({ t: performance.now(), dy: event.deltaY });
  el.addEventListener('wheel', record, { capture: true, passive: true });
  pickReaderAnchor(recorder, el);
  recorder.start();
  await frames(2);
  if (flicks) {
    for (let i = 0; i < flicks; i++) if (!(await flick(dy))) return { skipped: 'no momentum input in this engine' };
  } else {
    for (let i = 0; i < steps; i++) {
      await wheel(dy);
      await sleep(50);
    }
  }
  await sleep(600);
  el.removeEventListener('wheel', record, { capture: true });
  const all = recorder.stop();
  let noise = 0;
  let windows = 0;
  for (let base = 0; base + 21 <= all.length; base += 10) {
    windows++;
    noise = Math.max(noise, ...scoreLanding(all, base, base + 21, events, 0).top);
  }
  return { noise: round(noise), windows, wheelEvents: events.length, frames: all.length };
}
