/**
 * Behavior tests for the background-activity types + helpers.
 * All expected values are hardcoded — no production logic re-derived here.
 */
import { describe, it, expect } from 'vitest';
import {
  BackgroundWorkKindSchema,
  BackgroundActivitySchema,
  toActivityTask,
  deriveBackgroundActivity,
  type BackgroundTask,
} from '../index.js';

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 'b-1',
    kind: 'bash',
    toolName: 'Bash',
    toolUseId: 'tu-1',
    command: 'pnpm dev',
    description: 'dev server',
    outputPath: '/tmp/b-1.output',
    startedAt: 1000,
    endedAt: null,
    status: 'running',
    lastOutputLine: null,
    summary: null,
    usage: null,
    ...overrides,
  };
}

describe('BackgroundWorkKindSchema', () => {
  it('accepts the four kinds', () => {
    for (const kind of ['bash', 'agent', 'workflow', 'other']) {
      expect(BackgroundWorkKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('rejects unknown kinds', () => {
    expect(() => BackgroundWorkKindSchema.parse('local_bash')).toThrow();
  });
});

describe('toActivityTask', () => {
  it('picks id, kind, description, startedAt', () => {
    expect(toActivityTask(makeTask())).toEqual({
      id: 'b-1',
      kind: 'bash',
      description: 'dev server',
      startedAt: 1000,
    });
  });

  it('falls back to command when description is empty', () => {
    expect(toActivityTask(makeTask({ description: '' }))).toEqual({
      id: 'b-1',
      kind: 'bash',
      description: 'pnpm dev',
      startedAt: 1000,
    });
  });
});

describe('deriveBackgroundActivity', () => {
  it('returns undefined for an empty list', () => {
    expect(deriveBackgroundActivity([])).toBeUndefined();
  });

  it('counts by kind and totals', () => {
    const activity = deriveBackgroundActivity([
      toActivityTask(makeTask({ id: 'a-1', kind: 'agent', description: 'reviewer' })),
      toActivityTask(makeTask({ id: 'a-2', kind: 'agent', description: 'tester' })),
      toActivityTask(makeTask({ id: 'b-1', kind: 'bash' })),
      toActivityTask(makeTask({ id: 'w-1', kind: 'workflow', description: 'deploy' })),
    ]);
    expect(activity).toEqual({
      total: 4,
      byKind: { agent: 2, bash: 1, workflow: 1 },
      tasks: [
        { id: 'a-1', kind: 'agent', description: 'reviewer', startedAt: 1000 },
        { id: 'a-2', kind: 'agent', description: 'tester', startedAt: 1000 },
        { id: 'b-1', kind: 'bash', description: 'dev server', startedAt: 1000 },
        { id: 'w-1', kind: 'workflow', description: 'deploy', startedAt: 1000 },
      ],
    });
  });

  it('validates against BackgroundActivitySchema', () => {
    const activity = deriveBackgroundActivity([toActivityTask(makeTask())]);
    expect(BackgroundActivitySchema.parse(activity)).toEqual(activity);
  });
});
