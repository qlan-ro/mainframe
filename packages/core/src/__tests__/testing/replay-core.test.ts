// packages/core/src/__tests__/testing/replay-core.test.ts
import { describe, it, expect } from 'vitest';
import {
  createReplayState,
  drainOutputs,
  drainOptionalInterrupts,
  peekInput,
  consumeInput,
  isExhausted,
  messagesFromEvents,
} from '../../testing/replay-core.js';

// Mirrors the real cadence: spawn emits nothing (onInit arrives after the first message), then each
// `in` marker is followed by its run of `out` events.
const FIXTURE = [
  '{"dir":"in","method":"sendMessage","args":["create"],"delayMs":0}',
  '{"dir":"out","method":"onInit","args":["s1"],"delayMs":40}',
  '{"dir":"out","method":"onMessage","args":[[{"type":"text","text":"ok"}]],"delayMs":50}',
  '{"dir":"out","method":"onPermission","args":[{"requestId":"r1"}],"delayMs":60}',
  '{"dir":"in","method":"respondToPermission","args":[{"requestId":"r1"}],"delayMs":100}',
  '{"dir":"out","method":"onResult","args":[{}],"delayMs":120}',
].join('\n');

describe('replay-core', () => {
  it('spawn drains zero leading outputs (first event is an in-marker)', () => {
    const state = createReplayState(FIXTURE);
    expect(drainOutputs(state).map((e) => e.method)).toEqual([]);
    expect(state.cursor).toBe(0);
  });
  it('consumeInput skips one in-marker, then drainOutputs returns that turn', () => {
    const state = createReplayState(FIXTURE);
    drainOutputs(state); // spawn (no-op)
    expect(consumeInput(state)?.method).toBe('sendMessage');
    expect(drainOutputs(state).map((e) => e.method)).toEqual(['onInit', 'onMessage', 'onPermission']);
  });
  it('next interaction consumes its in-marker and drains to the end', () => {
    const state = createReplayState(FIXTURE);
    drainOutputs(state);
    consumeInput(state);
    drainOutputs(state);
    expect(consumeInput(state)?.method).toBe('respondToPermission');
    expect(drainOutputs(state).map((e) => e.method)).toEqual(['onResult']);
    expect(isExhausted(state)).toBe(true);
  });
  it('consumeInput returns null when the cursor is on an out event', () => {
    const state = createReplayState(FIXTURE);
    consumeInput(state); // skip the leading sendMessage marker
    expect(consumeInput(state)).toBeNull(); // now on onInit (out)
    expect(state.cursor).toBe(1);
  });

  it('drainOutputs includes fx events (applied to disk by the caller) and stops at the next in-marker', () => {
    const fixture = [
      '{"dir":"in","method":"sendMessage","args":["edit"],"delayMs":0}',
      '{"dir":"out","method":"onMessage","args":[[{"type":"tool_use","name":"Edit","input":{"file_path":"/x/index.ts"}}]],"delayMs":10}',
      '{"dir":"fx","method":"fx","args":[],"delayMs":20,"files":[{"path":"index.ts","content":"hi"}],"deleted":[]}',
      '{"dir":"out","method":"onResult","args":[{}],"delayMs":30}',
      '{"dir":"in","method":"sendMessage","args":["next"],"delayMs":40}',
    ].join('\n');
    const state = createReplayState(fixture);
    consumeInput(state);
    const batch = drainOutputs(state);
    expect(batch.map((e) => e.dir)).toEqual(['out', 'fx', 'out']);
    expect(batch[1]?.files?.[0]?.path).toBe('index.ts');
    expect(consumeInput(state)?.method).toBe('sendMessage'); // stopped at the next in-marker
  });

  it('drainOptionalInterrupts skips stray interrupt markers (and their outputs) when seeking sendMessage', () => {
    // Mirrors context-picker.0: turn 1, then app-issued interrupts (with an onContextUsage between),
    // then turn 2. The replay seeks sendMessage but the cursor sits on interrupts → tolerate them.
    const fixture = [
      '{"dir":"in","method":"sendMessage","args":["one"],"delayMs":0}',
      '{"dir":"out","method":"onResult","args":[{}],"delayMs":10}',
      '{"dir":"in","method":"interrupt","args":[],"delayMs":20}',
      '{"dir":"in","method":"interrupt","args":[],"delayMs":21}',
      '{"dir":"out","method":"onContextUsage","args":[{}],"delayMs":22}',
      '{"dir":"in","method":"interrupt","args":[],"delayMs":23}',
      '{"dir":"in","method":"sendMessage","args":["two"],"delayMs":30}',
      '{"dir":"out","method":"onMessage","args":[[{"type":"text","text":"Summary:"}]],"delayMs":40}',
    ].join('\n');
    const state = createReplayState(fixture);
    consumeInput(state); // turn 1 sendMessage
    drainOutputs(state); // onResult
    // Now on the first interrupt marker. Seeking sendMessage: skip interrupts, surface their outputs.
    const skipped = drainOptionalInterrupts(state);
    expect(skipped.map((e) => e.method)).toEqual(['onContextUsage']);
    expect(consumeInput(state)?.args[0]).toBe('two'); // cursor advanced past all interrupts
    expect(drainOutputs(state).map((e) => e.method)).toEqual(['onMessage']);
  });

  it('drainOptionalInterrupts is a no-op when the cursor is not on an interrupt', () => {
    const state = createReplayState(FIXTURE);
    expect(drainOptionalInterrupts(state)).toEqual([]); // first event is a sendMessage marker
    expect(state.cursor).toBe(0);
  });

  it('peekInput reports the method at the cursor without consuming it', () => {
    const state = createReplayState(FIXTURE);
    expect(peekInput(state, 'sendMessage')).toBe(true);
    expect(peekInput(state, 'interrupt')).toBe(false);
    expect(state.cursor).toBe(0);
  });

  it('messagesFromEvents reconstructs assistant/tool messages from out events (for loadHistory)', () => {
    const state = createReplayState(
      [
        '{"dir":"in","method":"sendMessage","args":["edit"],"delayMs":0}',
        '{"dir":"out","method":"onMessage","args":[[{"type":"tool_use","name":"Edit","input":{"file_path":"/x/index.ts"}}]],"delayMs":10}',
        '{"dir":"out","method":"onToolResult","args":[[{"type":"tool_result","content":"ok"}]],"delayMs":20}',
      ].join('\n'),
    );
    const messages = messagesFromEvents(state.events);
    expect(messages.map((m) => m.role)).toEqual(['assistant', 'user']);
    const block = (messages[0]?.content as Array<Record<string, unknown>>)[0];
    expect(block?.['name']).toBe('Edit');
  });
});
