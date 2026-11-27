/**
 * A-park, A-wheel, A-bound (#463): a long sub-agent's steps on the `agent` variant, paged by the app's
 * own `HistoricalAgentSteps` from the synthetic pager.
 *
 * - A-park: the reader is parked in the steps (400 px under their top boundary, or at offset 0 in the
 *   tab) and one older page lands. Pass: the reader's block moves ≤ 1 px for 2 s.
 * - A-wheel: the reader wheels up from the end of the steps through several pages, each requested by
 *   the app's gesture rule and landing 60 ms ±30% later. Scored per landing as S-top scores one
 *   (`short-window.ts`): the wheel's own travel is removed and the rest is the jump. Pass: ≤ 2 px, the
 *   block never lost.
 * - A-bound: page up `pages` pages, then back down to the end. Report only: DOM nodes in the scroller,
 *   step rows, and the messages and items the sub-agent's entry holds, at open, at the peak, at the top
 *   and back at the end. WebKit has no `performance.memory`, so the DOM and the held items are the measure.
 */
import { historyKey, useSubagentHistoryStore } from '@/features/chat/messages/turn/subagent-history-store';
import { agentPager } from '../agent-pager';
import { wheel } from '../input';
import { params } from '../params';
import { Recorder, frames, maxDrift, round, sleep, viewport, type Sample } from '../probe';
import { CHAT_ID } from '../store';
import { scoreLanding } from './short-window';
import { park } from './setup';

const ROW = '[data-testid^="chat-row-agent-t"]';
const KEY = historyKey(CHAT_ID, 'rig-agent');
const entry = () => useSubagentHistoryStore.getState().entries.get(KEY);

async function waitFor(done: () => boolean, ms: number) {
  const until = performance.now() + ms;
  while (!done() && performance.now() < until) await sleep(20);
  return done();
}

async function place(el: HTMLElement, scrollTop: number) {
  el.scrollTop = scrollTop;
  await sleep(400);
  await frames(2);
  return { scrollTop: el.scrollTop };
}

async function ready() {
  await waitFor(() => !!document.querySelector(`[data-rig-viewport] ${ROW}`) && entry()?.loading === false, 10000);
  await document.fonts.ready;
  await sleep(1200);
  await frames(2);
}

/** Where an element's top is in the scrolled content. */
function offsetOf(el: HTMLElement, node: Element) {
  return node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
}
const rows = (el: HTMLElement) =>
  [...el.querySelectorAll(ROW)].filter((row) => /^chat-row-agent-t\d+$/.test(row.getAttribute('data-testid')!));

function count(el: HTMLElement) {
  const held = entry();
  return {
    nodes: el.querySelectorAll('*').length,
    rows: rows(el).length,
    messages: held?.messages.length ?? 0,
    items: held?.accumulator.itemsInOrder.length ?? 0,
  };
}

/** The reader's block: the first step row from `at` of the way down the viewport (not a block holding every step). */
function pickStep(el: HTMLElement, at = 0.4) {
  const line = el.getBoundingClientRect().top + el.clientHeight * at;
  const row = rows(el).find((node) => node.getBoundingClientRect().top >= line);
  if (!row) throw new Error('no step row under the reader');
  return row;
}

const landed = (from: number) => () => agentPager.landedAt.length > from && entry()?.loading === false;

export async function agentPark({ at = 'middle' }: { at?: 'middle' | 'top' }) {
  await ready();
  const el = viewport();
  const first = rows(el)[0]!;
  // The tab does not follow, so no wheel is needed to park in it (a wheel up near the top would load a page itself).
  const target = at === 'top' ? 0 : Math.round(offsetOf(el, first) + 400);
  const parked = params.inline ? await park(target) : await place(el, target);
  const recorder = new Recorder(el);
  recorder.anchor(pickStep(el, 0.4));
  const before = { height: el.scrollHeight, ...count(el) };
  recorder.start();
  await frames(2);
  const from = agentPager.landedAt.length;
  el.querySelector<HTMLElement>('[data-testid="chat-agent-earlier-rig-agent"]')!.click();
  const ok = await waitFor(landed(from), 5000);
  await sleep(2000);
  const samples = recorder.stop();
  return {
    at,
    landed: ok,
    maxDrift: round(maxDrift(samples)),
    anchorLost: samples.some((s) => s.top === null),
    heightChange: round(el.scrollHeight - before.height),
    parkedScrollTop: round(parked.scrollTop),
    rowsBefore: before.rows,
    rowsAfter: count(el).rows,
  };
}

interface WheelRecord {
  t: number;
  dy: number;
}

/** The anchor's top in content coordinates, from a sample. */
const contentTop = (s: Sample) => (s.top === null ? null : s.top + s.scrollTop);

function scoreLandings(all: Sample[], requests: number[], events: WheelRecord[]) {
  return agentPager.landedAt.slice(-requests.length).map((called, k) => {
    let shown = all.findIndex(
      (s, j) => j > requests[k]! && s.t >= called && Math.abs(s.height - all[j - 1]!.height) > 1,
    );
    if (shown < 1) shown = all.length - 1;
    const base = shown - 1;
    const end = Math.min(shown + 20, requests[k + 1] ?? all.length, all.length);
    const [b, s] = [contentTop(all[base]!), contentTop(all[shown]!)];
    const above = b === null || s === null ? 0 : Math.max(0, s - b);
    const { top } = scoreLanding(all, base, Math.max(end, shown + 1), events, above);
    return {
      jump: Math.max(0, ...top),
      lost: all.slice(base + 1, end).filter((x) => x.top === null).length,
      above: round(above),
      baseScrollTop: round(all[base]!.scrollTop),
      /** Frames around the landing: the anchor's top, scrollTop and content height (`debug`). */
      series: all
        .slice(Math.max(0, base - 1), Math.min(end, base + 6))
        .map((x) => [round(x.top ?? -1), round(x.scrollTop), round(x.height)]),
    };
  });
}

export async function agentWheel({
  dy = -120,
  steps = 60,
  debug = false,
}: {
  dy?: number;
  steps?: number;
  debug?: boolean;
}) {
  await ready();
  const el = viewport();
  const last = rows(el).at(-1)!;
  await park(Math.max(0, Math.round(offsetOf(el, last) - el.clientHeight / 2)));
  const recorder = new Recorder(el);
  const events: WheelRecord[] = [];
  const record = (event: WheelEvent) => events.push({ t: performance.now(), dy: event.deltaY });
  el.addEventListener('wheel', record, { capture: true, passive: true });
  const requests: number[] = [];
  agentPager.onRequest = () => {
    recorder.anchor(pickStep(el, 0.5));
    recorder.sample();
    requests.push(recorder.samples.length - 1);
  };
  recorder.anchor(pickStep(el, 0.5));
  recorder.start();
  await frames(2);
  let peak = count(el);
  for (let i = 0; i < steps; i++) {
    await wheel(dy);
    await sleep(50);
    const now = count(el);
    if (now.items > peak.items) peak = now;
  }
  await sleep(1200);
  agentPager.onRequest = null;
  el.removeEventListener('wheel', record, { capture: true });
  const all = recorder.stop();
  const landings = scoreLandings(all, requests, events);
  return {
    plain: params.plain,
    inline: params.inline,
    loads: requests.length,
    jump: round(Math.max(0, ...landings.map((l) => l.jump))),
    jumps: landings.map((l) => round(l.jump)),
    lostFrames: landings.reduce((acc, l) => acc + l.lost, 0),
    pageHeights: landings.map((l) => l.above),
    perLanding: landings.map(({ jump, baseScrollTop, series }) => ({
      jump: round(jump),
      baseScrollTop,
      ...(debug && { series }),
    })),
    peak,
    frames: all.length,
  };
}

async function pageOnce(el: HTMLElement, side: 'older' | 'newer') {
  const from = agentPager.landedAt.length;
  const held = rows(el);
  if (side === 'older') el.scrollTop = Math.max(0, offsetOf(el, held[0]!) - 40);
  else el.scrollTop = offsetOf(el, held.at(-1)!) - el.clientHeight + 120;
  await frames(1);
  await wheel(side === 'older' ? -60 : 60);
  return waitFor(landed(from), 3000);
}

export async function agentBound({ pages = 20 }: { pages?: number }) {
  await ready();
  const el = viewport();
  const open = count(el);
  let peak = open;
  let up = 0;
  for (let i = 0; i < pages * 3 && up < pages && entry()?.before; i++) {
    if (await pageOnce(el, 'older')) up++;
    await frames(3);
    const now = count(el);
    if (now.nodes > peak.nodes) peak = now;
  }
  await sleep(300);
  const top = count(el);
  let down = 0;
  for (let i = 0; i < pages * 3 && entry()?.later; i++) {
    if (await pageOnce(el, 'newer')) down++;
    await frames(3);
    const now = count(el);
    if (now.nodes > peak.nodes) peak = now;
  }
  await sleep(300);
  return {
    plain: params.plain,
    inline: params.inline,
    up,
    down,
    open,
    peak,
    top,
    after: count(el),
    later: entry()?.later,
  };
}
