import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ACTIVITY_JUMP_EVENT, type ActivityJump } from '@/features/session-panel/activity-source';
import { useFindInChatStore } from '../find/find-in-chat-store';
import type { TranscriptScrollController } from './transcript-scroll-context';

/** Rows mounted at once: the newest, so the tail is on screen at the first frame. */
export const FIRST_ROWS = 6;
/** Rows added per step while the rest of the window lands above. */
export const STEP_ROWS = 12;
/**
 * Before paint, at most this many passes may mount a slice, each larger than the last (12, 24, 48, then
 * `MAX_LAYOUT_STEP`), so a tail that is a long run of near-empty rows (a folded turn draws most of its
 * messages as 1 px slices) neither throws React's update-depth error nor mounts hundreds of rows before
 * the first frame. What is still missing lands in the task-sized slices below, and each of those slices
 * starts a new budget: a frame can run up to this many passes again while the content still does not
 * overflow.
 */
export const MAX_LAYOUT_PASSES = 8;
const MAX_LAYOUT_STEP = 96;

interface Row {
  id: string;
}

/**
 * Tail-first mount. The first window mounts its newest `FIRST_ROWS` rows, then the rest lands
 * above them `STEP_ROWS` at a time, one slice per task. A reader at the tail stays there (the owner
 * follows); a reader who has already moved up near the top is re-anchored per slice
 * (`beforePrepend`, committed in the same task by `flushSync`, so nothing that streams in between
 * can use the owner's record up). A jump to a row, and Find in the chat that owns it, show every
 * row once and for all: closing Find does not unmount them. A page of older messages that lands
 * meanwhile joins the rows still to come.
 *
 * The newest rows must fill the viewport before the first paint: if they are shorter, they would
 * paint at the top of an empty list and jump to the bottom when the next slice made it overflow.
 * So while the content does not overflow the viewport and rows are still waiting, the next slice
 * mounts in a layout effect (committed before paint), until it overflows or the window runs out.
 */
export function useTailFirstRows<T extends Row>(rows: T[], scroll: TranscriptScrollController | null): T[] {
  const [state, setState] = useState<{ startId: string | null; done: boolean }>({ startId: null, done: false });
  if (!state.done && state.startId === null && rows.length > 0) {
    const start = Math.max(0, rows.length - FIRST_ROWS);
    setState({ startId: rows[start]!.id, done: start === 0 });
  }
  const findOpen = useFindInChatStore((s) => s.isOpen) && scroll?.findOwner === true;
  const found = state.startId === null ? -1 : rows.findIndex((row) => row.id === state.startId);
  const startIndex = state.done || found < 0 ? 0 : found;
  const layoutPasses = useRef(0);
  const latest = useRef({ rows, scroll });
  latest.current = { rows, scroll };
  const chatId = scroll?.chatId;
  useEffect(() => {
    const showAll = () => setState((current) => (current.done ? current : { ...current, done: true }));
    const jump = (event: Event) => {
      if ((event as CustomEvent<ActivityJump>).detail.chatId === chatId) showAll();
    };
    window.addEventListener(ACTIVITY_JUMP_EVENT, jump);
    return () => window.removeEventListener(ACTIVITY_JUMP_EVENT, jump);
  }, [chatId]);
  useEffect(() => {
    if (findOpen) setState((current) => (current.done ? current : { ...current, done: true }));
  }, [findOpen]);
  useEffect(() => {
    if (startIndex <= 0) return;
    let frame = 0;
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        frame = 0;
        layoutPasses.current = 0;
        const { rows: all, scroll: owner } = latest.current;
        const at = all.findIndex((row) => row.id === state.startId);
        if (at <= 0) return;
        owner?.beforePrepend?.();
        const next = Math.max(0, at - STEP_ROWS);
        flushSync(() => setState({ startId: all[next]!.id, done: next === 0 }));
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [startIndex, state.startId]);
  const pending = startIndex > 0;
  useLayoutEffect(() => {
    if (!pending) return;
    const viewport = scroll?.viewportElement.current;
    if (!viewport || viewport.clientHeight === 0) return;
    // The owner's resize observer is created after the first paint, so keep the tail in view from here.
    scroll?.followNow?.();
    if (viewport.scrollHeight > viewport.clientHeight) return;
    if (layoutPasses.current >= MAX_LAYOUT_PASSES) return;
    const at = rows.findIndex((row) => row.id === state.startId);
    if (at <= 0) return;
    const step = Math.min(MAX_LAYOUT_STEP, STEP_ROWS * 2 ** layoutPasses.current);
    layoutPasses.current++;
    const next = Math.max(0, at - step);
    setState({ startId: rows[next]!.id, done: next === 0 });
  });
  const setPending = scroll?.tailPending?.set;
  useEffect(() => {
    setPending?.(pending);
    return () => setPending?.(false);
  }, [pending, setPending]);
  return pending ? rows.slice(startIndex) : rows;
}
