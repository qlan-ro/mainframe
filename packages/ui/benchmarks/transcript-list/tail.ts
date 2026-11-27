/**
 * Tail-first mount, watched to completion (`?progressive=1`): when each slice of rows
 * committed, when the whole window was in, and the main-thread gaps between task
 * boundaries (a MessageChannel loop; the gap a tick arrives late is the longest task
 * that ran in between). Works in every engine, unlike the Long Tasks observer.
 */
export interface TailRecord {
  start: number;
  /** One entry per commit of the progressive mount: rows mounted after it. */
  slices: { t: number; rows: number }[];
  gaps: { end: number; ms: number }[];
  fullAt: number;
  total: number;
}

export const tail: TailRecord = { start: 0, slices: [], gaps: [], fullAt: NaN, total: 0 };

let watching = false;
export function watchTasks() {
  if (watching) return;
  watching = true;
  const channel = new MessageChannel();
  let last = performance.now();
  channel.port1.onmessage = () => {
    const now = performance.now();
    if (now - last > 8) tail.gaps.push({ end: now, ms: now - last });
    last = now;
    if (Number.isNaN(tail.fullAt) || now < tail.fullAt + 500) channel.port2.postMessage(0);
    else watching = false;
  };
  channel.port2.postMessage(0);
}

/** Per slice: the longest gap that ended between its commit and the next one's (the last slice runs to 100 ms after). */
export function summarizeTail() {
  const slices = tail.slices;
  const longest = slices.map((slice, i) => {
    const until = slices[i + 1]?.t ?? slice.t + 100;
    return Math.max(0, ...tail.gaps.filter((g) => g.end >= slice.t && g.end < until).map((g) => g.ms));
  });
  const firstSlice = slices[0];
  const fullMs = Number.isFinite(tail.fullAt) ? tail.fullAt - tail.start : NaN;
  return {
    slices: slices.length,
    fullWindowMs: Math.round(fullMs * 10) / 10,
    firstSliceMs: firstSlice ? Math.round((firstSlice.t - tail.start) * 10) / 10 : NaN,
    longestSliceMs: Math.round(Math.max(0, ...longest.slice(1)) * 10) / 10,
    longestFirstMountMs: Math.round((longest[0] ?? 0) * 10) / 10,
    rowsAtFull: tail.total,
  };
}
