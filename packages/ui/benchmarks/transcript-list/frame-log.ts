/**
 * Per-frame evidence for the scroll bugs: one record per frame, taken (as `probe.ts` takes its samples) in a
 * ResizeObserver callback after layout, scroll anchoring and the list's own observers, just before paint.
 * Each record holds the scroll position, whether the owner follows, where the reader's block is, and what
 * happened since the previous frame: wheel input, every programmatic write of the position (with its caller),
 * rows added or removed, and the scenario's own marks (a send, a fold, a page landing, a trim).
 */
import { controls } from './controls';
import { viewport as rigViewport } from './probe';

export interface Write {
  via: 'scrollTop' | 'scrollBy';
  from: number;
  to: number;
  caller: string;
}

export interface FrameRecord {
  t: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  following: boolean | null;
  /** The reader's block: its offset from the viewport top, or null when it is not in the DOM. */
  anchorTop: number | null;
  anchorId: number;
  wheel: number;
  writes: Write[];
  added: number;
  removed: number;
  rows: number;
  marks: string[];
  /** What the scenario samples beside the position (`FrameLog`'s `extra`): the footer's parts, say. */
  extra?: Record<string, number | boolean | null>;
}

const BLOCKS = 'p, pre, table, li, h2, h3, img, [data-message-id]';

/** The call site that wrote the position: the first stack frame outside this file. */
function caller() {
  const lines = (new Error().stack ?? '').split('\n').filter((line) => line && !line.includes('frame-log'));
  return lines
    .slice(0, 3)
    .map((line) => line.trim().replace(/https?:\/\/[^/]+\//, ''))
    .join(' < ');
}

export class FrameLog {
  records: FrameRecord[] = [];
  private pending = { wheel: 0, writes: [] as Write[], added: 0, removed: 0, marks: [] as string[] };
  private anchorNode: Element | null = null;
  private anchorId = 0;
  private stopFns: (() => void)[] = [];
  private rowsDirty = true;
  private rowCount = 0;
  constructor(
    readonly el: HTMLElement = rigViewport(),
    private readonly extra?: () => Record<string, number | boolean | null>,
  ) {}

  mark(label: string) {
    this.pending.marks.push(label);
  }

  /** The block a third of the way down the viewport (where `use-scroll-owner.ts` reads the reader). */
  pickAnchor(at = 1 / 3) {
    const box = this.el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + this.el.clientHeight * at);
    const block = hit?.closest(BLOCKS) ?? null;
    this.anchorNode = block && this.el.contains(block) ? block : null;
    this.anchorId++;
    return this.anchorNode;
  }

  start() {
    const el = this.el;
    const proto = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    const log = this.pending;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get() {
        return proto.get!.call(this);
      },
      set(value: number) {
        const from = proto.get!.call(this) as number;
        proto.set!.call(this, value);
        log.writes.push({ via: 'scrollTop', from, to: proto.get!.call(this) as number, caller: caller() });
      },
    });
    const scrollBy = Element.prototype.scrollBy;
    el.scrollBy = function (this: HTMLElement, ...args: unknown[]) {
      const from = proto.get!.call(this) as number;
      (scrollBy as (...a: unknown[]) => void).apply(this, args);
      log.writes.push({ via: 'scrollBy', from, to: proto.get!.call(this) as number, caller: caller() });
    } as typeof el.scrollBy;
    const wheel = (event: WheelEvent) => {
      log.wheel += event.deltaY;
    };
    el.addEventListener('wheel', wheel, { passive: true, capture: true });
    const mutations = new MutationObserver((list) => {
      for (const m of list) {
        log.added += m.addedNodes.length;
        log.removed += m.removedNodes.length;
      }
      this.rowsDirty = true;
    });
    mutations.observe(el, { childList: true, subtree: true });
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.append(dot);
    let running = true;
    const observer = new ResizeObserver(() => running && this.sample());
    observer.observe(dot);
    const tick = () => {
      if (!running) return;
      dot.style.width = dot.style.width === '1px' ? '2px' : '1px';
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.stopFns.push(() => {
      running = false;
      observer.disconnect();
      dot.remove();
      mutations.disconnect();
      el.removeEventListener('wheel', wheel, { capture: true });
      delete (el as unknown as Record<string, unknown>).scrollTop;
      delete (el as unknown as Record<string, unknown>).scrollBy;
    });
  }

  private sample() {
    const el = this.el;
    if (this.rowsDirty) {
      this.rowCount = el.querySelectorAll('[data-message-id]').length;
      this.rowsDirty = false;
    }
    const node = this.anchorNode;
    const record: FrameRecord = {
      t: performance.now(),
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      following: controls.isFollowing ? controls.isFollowing() : null,
      anchorTop: node?.isConnected ? node.getBoundingClientRect().top - el.getBoundingClientRect().top : null,
      anchorId: this.anchorId,
      wheel: this.pending.wheel,
      writes: this.pending.writes.splice(0),
      added: this.pending.added,
      removed: this.pending.removed,
      rows: this.rowCount,
      marks: this.pending.marks.splice(0),
      ...(this.extra ? { extra: this.extra() } : {}),
    };
    this.pending.wheel = 0;
    this.pending.added = 0;
    this.pending.removed = 0;
    this.records.push(record);
  }

  stop() {
    this.stopFns.forEach((fn) => fn());
    this.stopFns = [];
    return this.records;
  }
}

/**
 * Movement of the reader's block that no input explains: per frame, the change of its offset while no wheel
 * event arrived in that frame or the `quiet` frames before it. Returns the largest such step, their sum, and
 * the frames (with their writes and marks) where it happened.
 */
export function unexplained(records: FrameRecord[], { quiet = 12, from = 0 } = {}) {
  let lastWheel = -Infinity;
  let worst = 0;
  let total = 0;
  const events: {
    i: number;
    t: number;
    step: number;
    scrollTop: number;
    following: boolean | null;
    writes: Write[];
    marks: string[];
  }[] = [];
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1]!;
    const cur = records[i]!;
    if (cur.wheel !== 0) lastWheel = i;
    if (i < from || i - lastWheel <= quiet || cur.anchorId !== prev.anchorId) continue;
    if (prev.anchorTop === null || cur.anchorTop === null) {
      if (prev.anchorTop !== null)
        events.push({
          i,
          t: cur.t,
          step: Infinity,
          scrollTop: cur.scrollTop,
          following: cur.following,
          writes: cur.writes,
          marks: cur.marks,
        });
      continue;
    }
    const step = cur.anchorTop - prev.anchorTop;
    if (Math.abs(step) >= 1) {
      worst = Math.max(worst, Math.abs(step));
      total += Math.abs(step);
      events.push({
        i,
        t: cur.t,
        step,
        scrollTop: cur.scrollTop,
        following: cur.following,
        writes: cur.writes,
        marks: cur.marks,
      });
    }
  }
  return { worst, total, events };
}
