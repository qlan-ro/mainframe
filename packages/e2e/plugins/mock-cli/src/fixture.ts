// packages/e2e/plugins/mock-cli/src/fixture.ts
// Mirror of packages/core/src/testing/{recording-format,replay-core}.ts — kept standalone so this
// plugin bundles without importing workspace internals (reference impl for 3rd-party adapters).

export interface RecordedFile {
  path: string;
  content: string;
}

export interface RecordedEvent {
  dir: 'in' | 'out' | 'fx';
  method: string;
  args: unknown[];
  delayMs: number;
  files?: RecordedFile[];
  deleted?: string[];
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

/**
 * Drain the run of emittable events from the cursor — `out` events (replayed to the sink) and `fx`
 * events (file-effects applied to disk) — stopping at the next `in` marker or end. The caller
 * dispatches by `dir`.
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

/**
 * Skip leading `interrupt` in-markers and return the output run that followed each (the caller
 * emits them). `interrupt` is a fire-and-forget control signal the desktop app issues on its own
 * (e.g. while the composer is edited), so it is recorded non-deterministically and may not recur at
 * the same cursor position in replay. When seeking any other method, tolerate stray interrupts by
 * consuming them here rather than erroring on the method mismatch.
 */
export function drainOptionalInterrupts(state: ReplayState): RecordedEvent[] {
  const drained: RecordedEvent[] = [];
  let ev = state.events[state.cursor];
  while (ev && ev.dir === 'in' && ev.method === 'interrupt') {
    state.cursor++; // consume the interrupt marker
    while (state.cursor < state.events.length) {
      const out = state.events[state.cursor];
      if (!out || out.dir === 'in') break;
      drained.push(out);
      state.cursor++;
    }
    ev = state.events[state.cursor];
  }
  return drained;
}

/** True when the cursor sits on an `in` marker for `method` (without consuming it). */
export function peekInput(state: ReplayState, method: string): boolean {
  const ev = state.events[state.cursor];
  return !!ev && ev.dir === 'in' && ev.method === method;
}

/** Reconstruct assistant messages from `out` onMessage events — used by ReplaySession.loadHistory. */
export function messagesFromEvents(events: RecordedEvent[]): { role: string; content: unknown[] }[] {
  const messages: { role: string; content: unknown[] }[] = [];
  for (const ev of events) {
    if (ev.dir !== 'out') continue;
    if (ev.method === 'onMessage') {
      const content = (ev.args[0] as unknown[]) ?? [];
      messages.push({ role: 'assistant', content });
    } else if (ev.method === 'onToolResult') {
      const content = (ev.args[0] as unknown[]) ?? [];
      messages.push({ role: 'user', content });
    }
  }
  return messages;
}
