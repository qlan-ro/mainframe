// packages/core/src/testing/replay-core.ts
import { parseFixture, type RecordedEvent } from './recording-format.js';

export interface ReplayState {
  events: RecordedEvent[];
  cursor: number;
}

export function createReplayState(text: string): ReplayState {
  return { events: parseFixture(text), cursor: 0 };
}

export function isExhausted(state: ReplayState): boolean {
  return state.cursor >= state.events.length;
}

/** If the cursor is on an `in` marker, consume it (advance) and return it; otherwise return null. */
export function consumeInput(state: ReplayState): RecordedEvent | null {
  const ev = state.events[state.cursor];
  if (ev && ev.dir === 'in') {
    state.cursor++;
    return ev;
  }
  return null;
}

/** Drain the run of consecutive `out` events from the cursor (stops at the next `in` marker or end). */
export function drainOutputs(state: ReplayState): RecordedEvent[] {
  const out: RecordedEvent[] = [];
  while (state.cursor < state.events.length) {
    const ev = state.events[state.cursor];
    if (!ev || ev.dir !== 'out') break;
    out.push(ev);
    state.cursor++;
  }
  return out;
}
