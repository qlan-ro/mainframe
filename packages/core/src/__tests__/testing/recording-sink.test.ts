// packages/core/src/__tests__/testing/recording-sink.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createRecordingSink } from '../../testing/recording-sink.js';
import type { RecordedEvent } from '../../testing/recording-format.js';

describe('createRecordingSink', () => {
  it('records each call and forwards to the real sink', () => {
    const recorded: RecordedEvent[] = [];
    let clock = 0;
    const real = { onInit: vi.fn(), onExit: vi.fn() };
    const sink = createRecordingSink(real as never, {
      write: (e) => recorded.push(e),
      now: () => clock,
    });

    clock = 0;
    (sink as unknown as { onInit(id: string): void }).onInit('s1');
    clock = 120;
    (sink as unknown as { onExit(code: number): void }).onExit(0);

    expect(real.onInit).toHaveBeenCalledWith('s1');
    expect(real.onExit).toHaveBeenCalledWith(0);
    expect(recorded).toEqual([
      { dir: 'out', method: 'onInit', args: ['s1'], delayMs: 0 },
      { dir: 'out', method: 'onExit', args: [0], delayMs: 120 },
    ]);
  });

  it('reduces an Error arg to a safe shape', () => {
    const recorded: RecordedEvent[] = [];
    const real = { onError: vi.fn() };
    const sink = createRecordingSink(real as never, { write: (e) => recorded.push(e), now: () => 0 });
    (sink as unknown as { onError(e: Error): void }).onError(new Error('boom'));
    expect(recorded[0]).toEqual({
      dir: 'out',
      method: 'onError',
      args: [{ name: 'Error', message: 'boom' }],
      delayMs: 0,
    });
  });
});
