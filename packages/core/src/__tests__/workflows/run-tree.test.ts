import { describe, it, expect } from 'vitest';
import type { StepRunRecord } from '../../workflows/store/types.js';
import { buildRunTree } from '../../workflows/projection/run-tree.js';
import type { WorkflowDef } from '../../workflows/dsl/types.js';

function makeRec(
  stepPath: string,
  status: StepRunRecord['status'],
  overrides: Partial<StepRunRecord> = {},
): [string, StepRunRecord] {
  const rec: StepRunRecord = {
    id: `id-${stepPath}`,
    runId: 'run1',
    stepPath,
    stepId: stepPath,
    kind: 'set',
    attempt: 1,
    status,
    input: null,
    output: null,
    scratch: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: Date.now(),
    ...overrides,
  };
  return [stepPath, rec];
}

describe('buildRunTree — foreach with ambiguous status', () => {
  it('surfaces ambiguous status on the right iteration leaf and labels iterations from scratch', () => {
    const def: WorkflowDef = {
      version: 1,
      name: 'triage',
      steps: [
        {
          id: 'loop',
          foreach: '${ inputs.issues }',
          as: 'issue',
          steps: [{ id: 'classify', connector: 'http', with: {} }],
        },
      ],
    };

    // The loop step itself carries iteration labels in its scratch.
    const latest = new Map<string, StepRunRecord>([
      makeRec('steps.0', 'ambiguous', {
        kind: 'foreach',
        scratch: {
          iterations: [
            { index: 0, label: '308' },
            { index: 1, label: '312' },
          ],
        },
      }),
      // iteration 0 — succeeded
      makeRec('steps.0#0.steps.0', 'succeeded', { kind: 'connector' }),
      // iteration 1 — ambiguous service step
      makeRec('steps.0#1.steps.0', 'ambiguous', { kind: 'connector' }),
    ]);

    const tree = buildRunTree(def, latest);

    expect(tree).toHaveLength(1);
    const loopNode = tree[0];
    expect(loopNode).toBeDefined();
    expect(loopNode!.kind).toBe('foreach');
    expect(loopNode!.status).toBe('ambiguous');

    // Two iterations with correct labels.
    expect(loopNode!.iterations).toHaveLength(2);
    const [iter0, iter1] = loopNode!.iterations!;
    expect(iter0).toBeDefined();
    expect(iter1).toBeDefined();
    expect(iter0!.label).toBe('308');
    expect(iter1!.label).toBe('312');

    // The ambiguous leaf must appear in the second iteration.
    expect(iter1!.status).toBe('ambiguous');
    const classifyNode = iter1!.steps[0];
    expect(classifyNode).toBeDefined();
    expect(classifyNode!.status).toBe('ambiguous');
    expect(classifyNode!.stepPath).toBe('steps.0#1.steps.0');

    // First iteration is succeeded.
    expect(iter0!.status).toBe('succeeded');
  });
});

describe('buildRunTree — choose with call sub-step', () => {
  it('sets taken arm correctly and call node carries ref + childRunId', () => {
    const def: WorkflowDef = {
      version: 1,
      name: 'spike',
      steps: [
        {
          id: 'gate',
          choose: [
            {
              when: '${ inputs.mode = "fast" }',
              steps: [{ id: 'sub', call: 'child-workflow', with: {} }],
            },
            {
              else: true,
              steps: [{ id: 'slow', set: { speed: 'slow' } }],
            },
          ],
        },
      ],
    };

    // Only the first arm was taken.
    const latest = new Map<string, StepRunRecord>([
      makeRec('steps.0', 'succeeded', {
        kind: 'choose',
        scratch: { takenArm: 0 },
      }),
      makeRec('steps.0.choose.0.steps.0', 'succeeded', {
        kind: 'call',
        scratch: { childRunId: 'child-run-abc' },
      }),
    ]);

    const tree = buildRunTree(def, latest);

    expect(tree).toHaveLength(1);
    const gateNode = tree[0]!;
    expect(gateNode.kind).toBe('choose');
    expect(gateNode.arms).toHaveLength(2);

    const [arm0, arm1] = gateNode.arms!;
    expect(arm0).toBeDefined();
    expect(arm1).toBeDefined();

    // First arm was taken.
    expect(arm0!.taken).toBe(true);
    expect(arm0!.cond).toBe('${ inputs.mode = "fast" }');
    expect(arm0!.steps).toHaveLength(1);

    // Call node in the taken arm.
    const callNode = arm0!.steps[0]!;
    expect(callNode.kind).toBe('call');
    expect(callNode.ref).toBe('child-workflow');
    expect(callNode.childRunId).toBe('child-run-abc');

    // Second arm is not taken and has empty steps.
    expect(arm1!.taken).toBe(false);
    expect(arm1!.cond).toBe('else');
    expect(arm1!.steps).toHaveLength(0);
  });
});

describe('buildRunTree — leaf duration/sub/waitFor', () => {
  it('emits a formatted duration for a finished leaf', () => {
    const def: WorkflowDef = { version: 1, name: 'x', steps: [{ id: 'a', set: { v: 1 } } as any] };
    const start = 1_000_000;
    const latest = new Map([makeRec('steps.0', 'succeeded', { startedAt: start, finishedAt: start + 192_000 })]);
    const tree = buildRunTree(def, latest);
    expect(tree[0]!.duration).toBe('3m 12s');
  });

  it('emits waitFor from scratch on a waiting leaf', () => {
    const def: WorkflowDef = { version: 1, name: 'x', steps: [{ id: 'a', set: { v: 1 } } as any] };
    const latest = new Map([makeRec('steps.0', 'waiting', { scratch: { waitFor: 'user input' } })]);
    const tree = buildRunTree(def, latest);
    expect(tree[0]!.waitFor).toBe('user input');
  });

  it('omits duration when finishedAt is null', () => {
    const def: WorkflowDef = { version: 1, name: 'x', steps: [{ id: 'a', set: { v: 1 } } as any] };
    const latest = new Map([makeRec('steps.0', 'running', { finishedAt: null })]);
    const tree = buildRunTree(def, latest);
    expect(tree[0]!.duration).toBeUndefined();
  });
});

describe('buildRunTree — composite summary', () => {
  it('summarizes a parallel node as done-of-total', () => {
    const def: WorkflowDef = {
      version: 1,
      name: 'x',
      steps: [{ id: 'p', parallel: { a: [{ id: 'a1', set: { v: 1 } }], b: [{ id: 'b1', set: { v: 2 } }] } } as any],
    };
    const latest = new Map([
      makeRec('steps.0', 'running', { kind: 'parallel' }),
      makeRec('steps.0.parallel.a.0', 'succeeded'),
      makeRec('steps.0.parallel.b.0', 'running'),
    ]);
    const tree = buildRunTree(def, latest);
    expect(tree[0]!.summary).toBe('1 of 2');
  });
});
