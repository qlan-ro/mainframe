import { useEffect, useRef, useState } from 'react';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import { useFindInChatStore } from '../find/find-in-chat-store';
import type { TranscriptScrollController } from './transcript-scroll-context';

/** Rows mounted at once: the newest, so the tail is on screen at the first frame. */
export const FIRST_ROWS = 6;
/** Rows added per step while the rest of the window lands above. */
export const STEP_ROWS = 12;

interface Row {
  id: string;
}

/**
 * Tail-first mount. The first window mounts its newest `FIRST_ROWS` rows, then the rest lands
 * above them `STEP_ROWS` at a time, one slice per task. A reader at the tail stays there (the owner
 * follows); a reader who has already moved up near the top is re-anchored per slice
 * (`beforePrepend`). A jump to a row and an open Find show every row at once. A page of older
 * messages that lands meanwhile joins the rows still to come.
 */
export function useTailFirstRows<T extends Row>(rows: T[], scroll: TranscriptScrollController | null): T[] {
  const [state, setState] = useState<{ startId: string | null; done: boolean }>({ startId: null, done: false });
  if (!state.done && state.startId === null && rows.length > 0) {
    const start = Math.max(0, rows.length - FIRST_ROWS);
    setState({ startId: rows[start]!.id, done: start === 0 });
  }
  const findOpen = useFindInChatStore((s) => s.isOpen);
  const revealAll = state.done || findOpen;
  const found = state.startId === null ? -1 : rows.findIndex((row) => row.id === state.startId);
  const startIndex = revealAll || found < 0 ? 0 : found;
  const latest = useRef({ rows, scroll });
  latest.current = { rows, scroll };
  useEffect(() => {
    const showAll = () => setState((current) => (current.done ? current : { ...current, done: true }));
    window.addEventListener(ACTIVITY_JUMP_EVENT, showAll);
    return () => window.removeEventListener(ACTIVITY_JUMP_EVENT, showAll);
  }, []);
  useEffect(() => {
    if (startIndex <= 0) return;
    let frame = 0;
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        const { rows: all, scroll: owner } = latest.current;
        const at = all.findIndex((row) => row.id === state.startId);
        if (at <= 0) return;
        owner?.beforePrepend?.();
        const next = Math.max(0, at - STEP_ROWS);
        setState({ startId: all[next]!.id, done: next === 0 });
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [startIndex, state.startId]);
  return startIndex > 0 ? rows.slice(startIndex) : rows;
}
