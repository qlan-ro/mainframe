// packages/core/src/__tests__/testing/replay-core.test.ts
import { describe, it, expect } from 'vitest';
import {
  createReplayState,
  drainOutputs,
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
