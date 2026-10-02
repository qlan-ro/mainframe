import { expect, it } from 'vitest';
import { CommandExecutionMetadataSchema } from '../command-execution.js';
import { ItemMetaSchema } from '../acp/extensions-payload.js';

it.each([0, 1234])('validates exact integer duration %i with ordered normalized actions', (duration) => {
  const value = {
    commandActions: [
      { type: 'read', command: 'cat a', name: 'a', path: 'a' },
      { type: 'search', command: 'rg x', query: null, path: null },
      { type: 'listFiles', command: 'ls' },
      { type: 'unknown', command: 'future' },
    ],
    reportedDurationMs: duration,
  };
  expect(ItemMetaSchema.parse({ commandExecution: value }).commandExecution).toEqual(value);
});

it('keeps absence and empty actions distinct and rejects fractional durations', () => {
  expect(CommandExecutionMetadataSchema.parse({})).toEqual({});
  expect(CommandExecutionMetadataSchema.parse({ commandActions: [] })).toEqual({ commandActions: [] });
  expect(CommandExecutionMetadataSchema.safeParse({ reportedDurationMs: 1.5 }).success).toBe(false);
});
