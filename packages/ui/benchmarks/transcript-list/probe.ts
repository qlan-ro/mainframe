/**
 * The in-page recorder. Marks one visible element as the reader's anchor and,
 * on every animation frame, records its offset from the viewport top and the
 * gap to the bottom. A small readout shows the largest drift so far, for runs
 * by hand (P7).
 */
import { controls } from './controls';

export interface Sample {
  t: number;
  top: number | null;
  gap: number;
  scrollTop: number;
  height: number;
  anchor: number;
}

export const viewport = () => controls.viewport ?? document.querySelector<HTMLElement>('[data-rig-viewport]')!;
export const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const gapOf = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop;
export async function frames(n: number) {
  for (let i = 0; i < n; i++) await frame();
}

const BLOCKS = 'p, pre, table, li, h2, h3, img, [data-message-id]';

/** Finds the element again if a list re-mounted it: same message, same tag, same position. */
function locator(element: Element) {
  const message = element.closest('[data-message-id]');
  const id = message?.getAttribute('data-message-id');
  const tag = element.tagName;
  const nth = message ? [...message.querySelectorAll(tag)].indexOf(element) : -1;
  let current = element;
  return () => {
    if (current.isConnected) return current;
    const row = id ? document.querySelector(`[data-message-id="${CSS.escape(id)}"]`) : null;
    const found = row ? (nth < 0 ? row : row.querySelectorAll(tag)[nth]) : null;
    if (found) current = found;
    return found ?? null;
  };
}

export function pickAnchor(el: HTMLElement, at = 0.4) {
  const box = el.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height * at);
  const block = hit?.closest(BLOCKS) ?? hit;
  if (!block || !el.contains(block)) throw new Error('no anchor under the viewport centre');
  return block;
}

export class Recorder {
  samples: Sample[] = [];
  marks: { t: number; label: string; index: number }[] = [];
  private find: () => Element | null = () => null;
  private anchorId = 0;
  private running = false;
  constructor(private el: HTMLElement) {}
  anchor(element: Element) {
    this.find = locator(element);
    this.anchorId++;
  }
  mark(label: string) {
    this.marks.push({ t: performance.now(), label, index: this.samples.length });
  }
  sample() {
    const el = this.el;
    const node = this.find();
    const top = node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top : null;
    const sample = {
      t: performance.now(),
      top,
      gap: gapOf(el),
      scrollTop: el.scrollTop,
      height: el.scrollHeight,
      anchor: this.anchorId,
    };
    this.samples.push(sample);
    return sample;
  }
  /**
   * One sample per frame, taken in a ResizeObserver callback: after layout, scroll
   * anchoring and the list's own observers (created earlier, so called first), just
   * before paint. A rAF sample would read a state the screen never shows.
   */
  start() {
    this.running = true;
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.append(dot);
    const observer = new ResizeObserver(() => {
      if (this.running) readout(this.sample(), this.samples);
    });
    observer.observe(dot);
    const tick = () => {
      if (!this.running) return (observer.disconnect(), dot.remove());
      dot.style.width = dot.style.width === '1px' ? '2px' : '1px';
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  stop() {
    this.running = false;
    return this.samples;
  }
}

let hud: HTMLDivElement | null = null;
function readout(sample: Sample, samples: Sample[]) {
  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'rig-hud';
    document.body.append(hud);
  }
  const base = samples.find((s) => s.anchor === sample.anchor)?.top ?? 0;
  const drift = sample.top === null ? Infinity : Math.abs(sample.top - base);
  const max = Math.max(Number(hud.dataset.max ?? 0), drift);
  hud.dataset.max = String(max);
  hud.textContent = `drift ${drift.toFixed(1)} · max ${max.toFixed(1)} · gap ${sample.gap.toFixed(1)}`;
}

/** Largest |top - first top| per anchor. */
export function maxDrift(samples: Sample[]) {
  let max = 0;
  const base = new Map<number, number | null>();
  for (const s of samples) {
    if (!base.has(s.anchor)) base.set(s.anchor, s.top);
    const b = base.get(s.anchor);
    max = Math.max(max, s.top === null || b === null || b === undefined ? Infinity : Math.abs(s.top - b));
  }
  return max;
}

export const percentile = (values: number[], p: number) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};
export const round = (n: number, digits = 2) => (Number.isFinite(n) ? Number(n.toFixed(digits)) : n);
