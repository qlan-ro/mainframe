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

/**
 * Drain the run of emittable events (`out` replayed to the sink + `fx` applied to disk) from the
 * cursor, stopping at the next `in` marker or end. The caller dispatches by `dir`.
 */
export function drainOutputs(state: ReplayState): RecordedEvent[] {
  const out: RecordedEvent[] = [];
  while (state.cursor < state.events.length) {
    const ev = state.events[state.cursor];
    if (!ev || ev.dir === 'in') break;
    out.push(ev);
    state.cursor++;
  }
  return out;
}

/** Reconstruct messages from `out` onMessage/onToolResult events (for ReplaySession.loadHistory). */
export function messagesFromEvents(events: RecordedEvent[]): { role: string; content: unknown[] }[] {
  const messages: { role: string; content: unknown[] }[] = [];
  for (const ev of events) {
    if (ev.dir !== 'out') continue;
    if (ev.method === 'onMessage') messages.push({ role: 'assistant', content: (ev.args[0] as unknown[]) ?? [] });
    else if (ev.method === 'onToolResult') messages.push({ role: 'user', content: (ev.args[0] as unknown[]) ?? [] });
  }
  return messages;
}
