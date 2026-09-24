/**
 * Behavior tests for the background-activity types + helpers.
 * All expected values are hardcoded — no production logic re-derived here.
 */
import { describe, it, expect } from 'vitest';
import {
  BackgroundWorkKindSchema,
  BackgroundActivitySchema,
  BackgroundActivityTaskSchema,
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
  it('picks id, kind, description, startedAt, status, toolName, command', () => {
    expect(toActivityTask(makeTask({ outputPath: null }))).toEqual({
      id: 'b-1',
      kind: 'bash',
      description: 'dev server',
      startedAt: 1000,
      status: 'running',
      toolName: 'Bash',
      command: 'pnpm dev',
    });
  });

  it('falls back to command when description is empty', () => {
    expect(toActivityTask(makeTask({ description: '', outputPath: null }))).toEqual({
      id: 'b-1',
      kind: 'bash',
      description: 'pnpm dev',
      startedAt: 1000,
      status: 'running',
      toolName: 'Bash',
      command: 'pnpm dev',
    });
  });

  it('carries workflowName and runId through when the task is linked', () => {
    const activity = toActivityTask(
      makeTask({
        id: 'w-1',
        kind: 'workflow',
        description: 'deploy',
        workflowName: 'deploy',
        runId: 'run_1',
        outputPath: null,
      }),
    );
    expect(activity).toEqual({
      id: 'w-1',
      kind: 'workflow',
      description: 'deploy',
      startedAt: 1000,
      status: 'running',
      toolName: 'Bash',
      command: 'pnpm dev',
      workflowName: 'deploy',
      runId: 'run_1',
    });
    expect(BackgroundActivityTaskSchema.parse(activity)).toEqual(activity);
  });

  it('omits outputPath/endedAt/lastOutputLine/summary/usage/recovered/reportedType when null or absent', () => {
    const activity = toActivityTask(makeTask({ outputPath: null }));
    expect(activity).not.toHaveProperty('outputPath');
    expect(activity).not.toHaveProperty('endedAt');
    expect(activity).not.toHaveProperty('lastOutputLine');
    expect(activity).not.toHaveProperty('summary');
    expect(activity).not.toHaveProperty('usage');
    expect(activity).not.toHaveProperty('recovered');
    expect(activity).not.toHaveProperty('reportedType');
    expect(Object.keys(activity).sort()).toEqual([
      'command',
      'description',
      'id',
      'kind',
      'startedAt',
      'status',
      'toolName',
    ]);
  });

  it('sets each optional field only when the source task carries a non-null value', () => {
    const activity = toActivityTask(
      makeTask({
        status: 'completed',
        endedAt: 2000,
        lastOutputLine: 'done',
        summary: 'built successfully',
        usage: { totalTokens: 10, toolUses: 2, durationMs: 500 },
        recovered: true,
        reportedType: 'container_exec',
      }),
    );
    expect(activity).toMatchObject({
      outputPath: '/tmp/b-1.output',
      endedAt: 2000,
      lastOutputLine: 'done',
      summary: 'built successfully',
      usage: { totalTokens: 10, toolUses: 2, durationMs: 500 },
      recovered: true,
      reportedType: 'container_exec',
    });
  });

  it('never emits outputPath when the task has none', () => {
    expect(toActivityTask(makeTask({ outputPath: null }))).not.toHaveProperty('outputPath');
  });

  it('pins the field-set parity contract for a fully populated terminal task (AC18)', () => {
    const activity = toActivityTask(
      makeTask({
        status: 'completed',
        endedAt: 2000,
        lastOutputLine: 'done',
        summary: 'built successfully',
        usage: { totalTokens: 10, toolUses: 2, durationMs: 500 },
        recovered: true,
        reportedType: 'container_exec',
        workflowName: 'deploy',
        runId: 'run_1',
      }),
    );
    const roundTripped = JSON.parse(JSON.stringify(activity)) as Record<string, unknown>;
    expect(Object.keys(roundTripped).sort()).toEqual(
      [
        'id',
        'kind',
        'description',
        'startedAt',
        'status',
        'toolName',
        'command',
        'outputPath',
        'endedAt',
        'lastOutputLine',
        'summary',
        'usage',
        'recovered',
        'reportedType',
        'workflowName',
        'runId',
      ].sort(),
    );
  });

  it('pins the field-set parity contract for a minimal running task (AC18)', () => {
    const activity = toActivityTask(makeTask({ outputPath: null }));
    const roundTripped = JSON.parse(JSON.stringify(activity)) as Record<string, unknown>;
    expect(Object.keys(roundTripped).sort()).toEqual(
      ['id', 'kind', 'description', 'startedAt', 'status', 'toolName', 'command'].sort(),
    );
  });
});

describe('BackgroundActivityTaskSchema', () => {
  it('parses a legacy four-field payload (mobile-additive)', () => {
    const legacy = { id: 'b-1', kind: 'bash', description: 'dev server', startedAt: 1000 };
    expect(BackgroundActivityTaskSchema.parse(legacy)).toEqual(legacy);
  });

  it('parses a fully populated payload', () => {
    const full = {
      id: 'b-1',
      kind: 'other',
      description: 'dev server',
      startedAt: 1000,
      status: 'failed',
      toolName: 'Bash',
      command: 'sleep 5',
      outputPath: '/tmp/b-1.output',
      endedAt: 2000,
      lastOutputLine: 'boom',
      summary: 'failed',
      usage: { totalTokens: 1, toolUses: 1, durationMs: 1 },
      recovered: true,
      reportedType: 'container_exec',
      workflowName: 'deploy',
      runId: 'run_1',
    };
    expect(BackgroundActivityTaskSchema.parse(full)).toEqual(full);
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
        {
          id: 'a-1',
          kind: 'agent',
          description: 'reviewer',
          startedAt: 1000,
          status: 'running',
          toolName: 'Bash',
          command: 'pnpm dev',
          outputPath: '/tmp/b-1.output',
        },
        {
          id: 'a-2',
          kind: 'agent',
          description: 'tester',
          startedAt: 1000,
          status: 'running',
          toolName: 'Bash',
          command: 'pnpm dev',
          outputPath: '/tmp/b-1.output',
        },
        {
          id: 'b-1',
          kind: 'bash',
          description: 'dev server',
          startedAt: 1000,
          status: 'running',
          toolName: 'Bash',
          command: 'pnpm dev',
          outputPath: '/tmp/b-1.output',
        },
        {
          id: 'w-1',
          kind: 'workflow',
          description: 'deploy',
          startedAt: 1000,
          status: 'running',
          toolName: 'Bash',
          command: 'pnpm dev',
          outputPath: '/tmp/b-1.output',
        },
      ],
    });
  });

  it('validates against BackgroundActivitySchema', () => {
    const activity = deriveBackgroundActivity([toActivityTask(makeTask())]);
    expect(BackgroundActivitySchema.parse(activity)).toEqual(activity);
  });
});
