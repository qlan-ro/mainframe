/** P1 to P3: the reader's anchor while something changes above them. */
import { Recorder, frames, maxDrift, pickAnchor, round, sleep, frame, viewport } from '../probe';
import { wheel } from '../input';
import { params } from '../params';
import { store } from '../store';
import { approach, park, ready } from './setup';

async function watch(change: () => void | Promise<void>, ms = 2000) {
  const el = viewport();
  const recorder = new Recorder(el);
  recorder.anchor(pickAnchor(el));
  const before = { height: el.scrollHeight, scrollTop: el.scrollTop };
  recorder.start();
  await frame();
  await frame();
  recorder.mark('change');
  await change();
  await sleep(ms);
  const samples = recorder.stop();
  return {
    maxDrift: round(maxDrift(samples)),
    heightChange: round(el.scrollHeight - before.height),
    scrollTopChange: round(el.scrollTop - before.scrollTop),
    frames: samples.length,
    anchorLost: samples.some((s) => s.top === null),
  };
}

/** P1: a page of about 80 items lands above a parked reader (mid-history, or at offset 0). */
export async function p1({ at = 'middle', eager = false }: { at?: 'middle' | 'top'; eager?: boolean }) {
  await ready(1500, eager);
  const el = viewport();
  const parked = await park(at === 'top' ? 0 : Math.round(el.scrollHeight * 0.35), eager);
  let added = 0;
  const result = await watch(async () => {
    // The app's boundary row shows its loading state first, then the page lands (the indicator comes and goes).
    if (params.variant === 'app') {
      store.set({ loading: true });
      await frames(3);
    }
    added = store.prependPage();
  });
  return { ...result, at, pageMessages: added, parkedScrollTop: round(parked.scrollTop), parkedGap: round(parked.gap) };
}

/** P2: the page lands during 20 upward wheel events; run once with and once without the page. */
export async function p2({ prepend = true, eager = false }: { prepend?: boolean; eager?: boolean }) {
  await ready(1500, eager);
  const el = viewport();
  await park(Math.round(el.scrollHeight * 0.5), eager);
  const recorder = new Recorder(el);
  recorder.anchor(pickAnchor(el, 0.6));
  recorder.start();
  await frame();
  for (let i = 0; i < 20; i++) {
    if (i === 7 && prepend && params.variant === 'app') store.set({ loading: true });
    if (i === 8 && prepend) {
      recorder.mark('page');
      store.prependPage();
    }
    await wheel(-100);
    await sleep(50);
  }
  await sleep(1500);
  const samples = recorder.stop().filter((s) => s.top !== null);
  let runningMax = -Infinity;
  let againstWheel = 0;
  for (const s of samples) {
    runningMax = Math.max(runningMax, s.top!);
    againstWheel = Math.max(againstWheel, runningMax - s.top!);
  }
  const first = samples[0]?.top ?? NaN;
  const last = samples.at(-1)?.top ?? NaN;
  return { prepend, travelled: round(last - first), againstWheel: round(againstWheel), finalTop: round(last) };
}

/** P3: an image (+160 px), a code block, or a 600 px fold above the reader, after scrolling up or down. */
export async function p3({
  change,
  dir,
  turn,
  eager = false,
}: {
  change: 'image' | 'code' | 'fold';
  dir: 'up' | 'down';
  turn: number;
  eager?: boolean;
}) {
  await ready(change === 'fold' ? 2500 : 1500, eager);
  if (change === 'image') {
    const placed = await approach('img[src*="hold=1"]', 250, dir);
    return { change, dir, ...placed, ...(await watch(() => void fetch(`/rig-release?id=${turn}`))) };
  }
  if (change === 'code') {
    const placed = await approach(`[data-message-id="t${turn}-a5"] table`, 250, dir);
    return { change, dir, ...placed, ...(await watch(() => store.growCode(`t${turn}-a5`, turn, 12))) };
  }
  const answer = store.get().messages.at(-1)!.id;
  const placed = await approach(`[data-message-id="${answer}"]`, 150, dir);
  return { change, dir, ...placed, ...(await watch(() => store.set({ running: false }))) };
}

export { wheel };
