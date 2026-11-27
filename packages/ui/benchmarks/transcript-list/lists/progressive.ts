/**
 * `?progressive=1`: mount only the newest rows, then prepend the rest of the loaded
 * window a slice per task. The browser anchors each slice like a page landing, so
 * the reader stays put; the first frame shows the tail at a fraction of the cost.
 * Each commit is recorded (`tail.ts`) so the mount is scored to completion.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { params } from '../params';
import { tail, watchTasks } from '../tail';
import type { Row } from './row';

const FIRST_ROWS = 6;
const STEP_ROWS = 12;

export function useProgressiveRows(all: Row[]) {
  const [hidden, setHidden] = useState(() => (params.progressive ? Math.max(0, all.length - FIRST_ROWS) : 0));
  useEffect(() => {
    if (hidden <= 0) return;
    const timer = setTimeout(() => requestAnimationFrame(() => setHidden((h) => Math.max(0, h - STEP_ROWS))), 0);
    return () => clearTimeout(timer);
  }, [hidden]);
  const rows = hidden ? all.slice(hidden) : all;
  useLayoutEffect(() => {
    if (!params.progressive || tail.start === 0 || !Number.isNaN(tail.fullAt)) return;
    const t = performance.now();
    watchTasks();
    tail.slices.push({ t, rows: rows.length });
    if (hidden === 0) {
      tail.fullAt = t;
      tail.total = rows.length;
    }
  }, [hidden, rows.length]);
  return rows;
}
