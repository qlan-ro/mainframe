/** P6 scroll cost, and the P7 proxy: momentum flicks up through page loads (WKWebView harness only). */
import { Recorder, frame, percentile, round, sleep, viewport, type Sample } from '../probe';
import { flick, wheel } from '../input';
import { store } from '../store';
import { summarizeTail, tail } from '../tail';
import { ready } from './setup';

/** Scripted scroll: 30 px up on every frame for 3 s, from the bottom. */
export async function p6scroll({ seconds = 3, step = 30 }: { seconds?: number; step?: number }) {
  await ready(3000);
  const el = viewport();
  await wheel(-60);
  const times: number[] = [];
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end && el.scrollTop > 0) {
    el.scrollTop -= step;
    times.push(await frame());
  }
  const intervals = times.slice(1).map((t, i) => t - times[i]!);
  const fps = intervals.length / ((times.at(-1)! - times[0]!) / 1000);
  return {
    fps: round(fps, 1),
    frameP95: round(percentile(intervals, 95)),
    longFrames: intervals.filter((d) => d > 25).length,
    frames: times.length,
  };
}

/**
 * Per page load: whether the browser kept the page's height out of the reader's view
 * (an anchor step of half the page or more means it did not), the main-thread stall
 * while the page rendered, and the largest single-frame anchor step in the 12 frames
 * after it. A step can be threaded scrolling that went on during the stall, caught up
 * in one frame on the main thread, so it is a lead for the manual check, not a verdict.
 */
function pageSteps(samples: Sample[], pages: { index: number }[]) {
  return pages.map(({ index }) => {
    const window = samples.slice(index, index + 12);
    const steps = window
      .slice(1)
      .map((s, i) => (s.top === null || window[i]!.top === null ? Infinity : Math.abs(s.top - window[i]!.top!)));
    const stall = Math.max(0, ...window.slice(1).map((s, i) => s.t - window[i]!.t));
    const added = Math.max(0, ...window.map((s) => s.height)) - (samples[index - 1]?.height ?? window[0]!.height);
    const largest = Math.max(0, ...steps);
    return { pageHeight: round(added), stallMs: round(stall), largestStep: round(largest), held: largest < added / 2 };
  });
}

export async function p7proxy({
  loads = 5,
  flickPx = 1800,
  debug = false,
}: {
  loads?: number;
  flickPx?: number;
  debug?: boolean;
}) {
  await ready();
  const el = viewport();
  await wheel(-60);
  el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight * 3);
  await sleep(300);
  const recorder = new Recorder(el);
  const pages: { index: number }[] = [];
  const near = () => el.scrollTop < el.clientHeight * 1.5;
  recorder.anchor(el.querySelector('[data-message-id]')!);
  recorder.start();
  const onScroll = () => {
    if (!near() || pages.length >= loads || !store.hasMore()) return;
    recorder.anchor(
      document.elementFromPoint(
        el.getBoundingClientRect().left + el.clientWidth / 2,
        el.getBoundingClientRect().top + el.clientHeight / 2,
      )!,
    );
    pages.push({ index: recorder.samples.length });
    store.prependPage();
  };
  el.addEventListener('scroll', onScroll, { passive: true });
  for (let i = 0; i < 40 && pages.length < loads; i++) {
    if (!(await flick(-flickPx))) return { skipped: 'no momentum input in this engine' };
    await sleep(200);
  }
  await sleep(1500);
  el.removeEventListener('scroll', onScroll);
  const samples = recorder.stop();
  const perLoad = pageSteps(samples, pages);
  const around = debug
    ? pages.map(({ index: at }) =>
        samples
          .slice(Math.max(0, at - 5), at + 8)
          .map((s) => [
            Math.round(s.t),
            Math.round(s.top ?? NaN),
            Math.round(s.scrollTop),
            Math.round(s.height),
            s.anchor,
          ]),
      )
    : undefined;
  return {
    loads: perLoad,
    allHeld: perLoad.every((l) => l.held),
    maxStallMs: Math.max(0, ...perLoad.map((l) => l.stallMs)),
    largestStep: Math.max(0, ...perLoad.map((l) => l.largestStep)),
    around,
  };
}

/** Tail-first mount scored to completion: the time the whole window is in, and the longest task per slice. */
export async function p6tail() {
  for (let i = 0; i < 400 && Number.isNaN(tail.fullAt); i++) await sleep(25);
  await sleep(600);
  return summarizeTail();
}
