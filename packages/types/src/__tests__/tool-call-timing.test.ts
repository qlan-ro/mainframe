import { describe, expect, it } from 'vitest';
import { ToolCallTimingSchema } from '../index.js';

describe('ToolCallTimingSchema', () => {
  it.each([{ startedAt: 1000 }, { startedAt: 1000, completedAt: 1200 }, { startedAt: 0, completedAt: 0 }])(
    'preserves valid epoch milliseconds %j',
    (timing) => expect(ToolCallTimingSchema.parse(timing)).toEqual(timing),
  );

  it.each([
    {},
    { completedAt: 1200 },
    { startedAt: -1 },
    { startedAt: 1.5 },
    { startedAt: Number.MAX_SAFE_INTEGER + 1 },
    { startedAt: 1000, completedAt: 999 },
    { startedAt: 1000, completedAt: -1 },
    { startedAt: 1000, completedAt: 1.5 },
    { startedAt: 1000, completedAt: Number.MAX_SAFE_INTEGER + 1 },
    { startedAt: '1000' },
    { startedAt: 1000, completedAt: null },
  ])('rejects malformed timing %j', (timing) => {
    expect(ToolCallTimingSchema.safeParse(timing).success).toBe(false);
  });
});
