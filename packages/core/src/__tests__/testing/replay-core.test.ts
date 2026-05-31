// packages/core/src/__tests__/testing/replay-core.test.ts
import { describe, it, expect } from 'vitest';
import { createReplayState, drainOutputs, consumeInput, isExhausted } from '../../testing/replay-core.js';

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
});
