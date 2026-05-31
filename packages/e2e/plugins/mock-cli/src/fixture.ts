// packages/e2e/plugins/mock-cli/src/fixture.ts
// Mirror of packages/core/src/testing/{recording-format,replay-core}.ts — kept standalone so this
// plugin bundles without importing workspace internals (reference impl for 3rd-party adapters).

export interface RecordedEvent {
  dir: 'in' | 'out';
  method: string;
  args: unknown[];
  delayMs: number;
}

export interface ReplayState {
  events: RecordedEvent[];
  cursor: number;
}

export function createReplayState(text: string): ReplayState {
  const events = text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RecordedEvent);
  return { events, cursor: 0 };
}

export function isExhausted(state: ReplayState): boolean {
  return state.cursor >= state.events.length;
}

/** If the cursor is on an `in` marker, consume it and return it; otherwise return null. */
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
