// packages/core/src/__tests__/testing/recording-format.test.ts
import { describe, it, expect } from 'vitest';
import {
  safeArgs,
  sanitizeKey,
  fixtureFileName,
  parseFixture,
  type RecordedEvent,
} from '../../testing/recording-format.js';

describe('recording-format', () => {
  it('safeArgs reduces an Error to {name,message}', () => {
    expect(safeArgs([new Error('boom')])).toEqual([{ name: 'Error', message: 'boom' }]);
  });
  it('safeArgs round-trips plain JSON values', () => {
    expect(safeArgs(['s', { a: 1 }, [2, 3]])).toEqual(['s', { a: 1 }, [2, 3]]);
  });
  it('safeArgs falls back to String() on non-serializable values', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(typeof safeArgs([circular])[0]).toBe('string');
  });
  it('sanitizeKey makes a filename-safe segment', () => {
    expect(sanitizeKey('permissions / Interactive!!')).toBe('permissions-Interactive');
  });
  it('fixtureFileName combines key + index', () => {
    expect(fixtureFileName('permissions-interactive', 0)).toBe('permissions-interactive.0.ndjson');
  });
  it('parseFixture parses NDJSON, ignoring blank lines', () => {
    const text =
      '{"dir":"in","method":"sendMessage","args":["hi"],"delayMs":0}\n\n{"dir":"out","method":"onExit","args":[0],"delayMs":5}\n';
    const events: RecordedEvent[] = parseFixture(text);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ dir: 'in', method: 'sendMessage', args: ['hi'], delayMs: 0 });
    expect(events[1]?.dir).toBe('out');
  });
});
