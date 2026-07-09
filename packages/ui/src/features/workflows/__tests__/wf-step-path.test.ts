/**
 * wf-step-path — TDD tests for the immutable get/patch/insert/remove helpers
 * that address a step (or a step's child list) via a `WfStepPath`.
 */
import { describe, it, expect } from 'vitest';
import {
  getStepsAtPath,
  patchStepAtPath,
  insertStepAtPath,
  removeStepAtPath,
} from '@/features/workflows/editor/wf-step-path';
import type { WfStep, WfArm } from '@/features/workflows/editor/wf-draft-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function chooseFixture(): { root: WfStep[]; arm0: WfArm; arm1: WfArm; sibling: WfStep } {
  const arm0: WfArm = { when: 'a', steps: [{ id: 'x0', kind: 'agent', agent: { prompt: 'p0' } }] };
  const arm1: WfArm = { when: 'b', steps: [{ id: 'x1', kind: 'agent', agent: { prompt: 'p1' } }] };
  const choose: WfStep = { id: 'c1', kind: 'choose', arms: [arm0, arm1] };
  const sibling: WfStep = { id: 'sib', kind: 'set', set: { v: 1 } };
  return { root: [choose, sibling], arm0, arm1, sibling };
}

function foreachFixture(): { root: WfStep[]; body0: WfStep } {
  const body0: WfStep = { id: 'b0', kind: 'agent', agent: { prompt: 'p0' } };
  const foreach: WfStep = { id: 'fe1', kind: 'foreach', over: '${ items }', as: 'item', steps: [body0] };
  return { root: [foreach], body0 };
}

// ── choose arm addressing ─────────────────────────────────────────────────────

describe('wf-step-path: choose arm addressing', () => {
  it("getStepsAtPath returns an arm's steps list", () => {
    const { root, arm1 } = chooseFixture();
    expect(getStepsAtPath(root, [0, { arm: 1 }])).toBe(arm1.steps);
  });

  it('patchStepAtPath patches a step inside one arm, leaving the sibling arm and root step untouched', () => {
    const { root, arm0, sibling } = chooseFixture();
    const next = patchStepAtPath(root, [0, { arm: 1 }, 0], { name: 'patched' });

    const nextChoose = next[0]!;
    if (nextChoose.kind !== 'choose') throw new Error('expected choose');
    expect(nextChoose.arms[1]!.steps[0]!.name).toBe('patched');
    expect(nextChoose.arms[0]).toBe(arm0); // untouched sibling arm, same reference
    expect(next[1]).toBe(sibling); // untouched sibling root step, same reference
  });

  it('insertStepAtPath appends to one arm only, leaving the sibling arm untouched', () => {
    const { root, arm0, arm1 } = chooseFixture();
    const newStep: WfStep = { id: 'new1', kind: 'set', set: { v: 2 } };
    const next = insertStepAtPath(root, [0, { arm: 1 }], newStep);

    const nextChoose = next[0]!;
    if (nextChoose.kind !== 'choose') throw new Error('expected choose');
    expect(nextChoose.arms[1]!.steps).toHaveLength(2);
    expect(nextChoose.arms[1]!.steps[1]).toBe(newStep);
    expect(nextChoose.arms[0]).toBe(arm0);
    expect(nextChoose.arms[0]!.steps).toBe(arm0.steps);
    void arm1;
  });

  it('removeStepAtPath removes a step from one arm only, leaving the sibling arm untouched', () => {
    const { root, arm0 } = chooseFixture();
    const next = removeStepAtPath(root, [0, { arm: 1 }, 0]);

    const nextChoose = next[0]!;
    if (nextChoose.kind !== 'choose') throw new Error('expected choose');
    expect(nextChoose.arms[1]!.steps).toHaveLength(0);
    expect(nextChoose.arms[0]).toBe(arm0);
  });
});

// ── foreach body addressing (bare trailing number, no selector token) ────────

describe('wf-step-path: foreach body addressing', () => {
  it("getStepsAtPath returns the foreach body when the path ends at the foreach's own index", () => {
    const { root, body0 } = foreachFixture();
    const list = getStepsAtPath(root, [0]);
    expect(list).toHaveLength(1);
    expect(list[0]).toBe(body0);
  });

  it('patchStepAtPath patches a step inside the foreach body via [0, j]', () => {
    const { root } = foreachFixture();
    const next = patchStepAtPath(root, [0, 0], { name: 'looped' });
    const nextForeach = next[0]!;
    if (nextForeach.kind !== 'foreach') throw new Error('expected foreach');
    expect(nextForeach.steps[0]!.name).toBe('looped');
    expect(nextForeach.over).toBe('${ items }');
    expect(nextForeach.as).toBe('item');
  });

  it('insertStepAtPath appends into the foreach body via the bare index [0]', () => {
    const { root, body0 } = foreachFixture();
    const newStep: WfStep = { id: 'new2', kind: 'set', set: { v: 3 } };
    const next = insertStepAtPath(root, [0], newStep);
    const nextForeach = next[0]!;
    if (nextForeach.kind !== 'foreach') throw new Error('expected foreach');
    expect(nextForeach.steps).toHaveLength(2);
    expect(nextForeach.steps[0]).toBe(body0);
    expect(nextForeach.steps[1]).toBe(newStep);
  });

  it('removeStepAtPath removes a step inside the foreach body via [0, j]', () => {
    const { root } = foreachFixture();
    const next = removeStepAtPath(root, [0, 0]);
    const nextForeach = next[0]!;
    if (nextForeach.kind !== 'foreach') throw new Error('expected foreach');
    expect(nextForeach.steps).toHaveLength(0);
  });
});

// ── invalid paths never throw, return the original root unchanged ───────────

describe('wf-step-path: invalid paths', () => {
  it('patchStepAtPath with an out-of-range index returns the original root unchanged', () => {
    const { root } = chooseFixture();
    expect(patchStepAtPath(root, [99], { name: 'nope' })).toBe(root);
  });

  it('removeStepAtPath with an out-of-range index returns the original root unchanged', () => {
    const { root } = chooseFixture();
    expect(removeStepAtPath(root, [99])).toBe(root);
  });

  it('insertStepAtPath with an out-of-range arm index returns the original root unchanged', () => {
    const { root } = chooseFixture();
    const newStep: WfStep = { id: 'new3', kind: 'set', set: { v: 4 } };
    expect(insertStepAtPath(root, [0, { arm: 5 }], newStep)).toBe(root);
  });

  it("patchStepAtPath with a selector mismatched against the step's kind returns the original root unchanged", () => {
    const { root } = foreachFixture(); // root[0] is 'foreach', not 'choose'
    expect(patchStepAtPath(root, [0, { arm: 0 }, 0], { name: 'nope' })).toBe(root);
  });

  it('getStepsAtPath with an unknown branch name returns an empty list, never throws', () => {
    const branchStep: WfStep = { id: 'par1', kind: 'parallel', branches: { a: [] } };
    expect(getStepsAtPath([branchStep], [0, { branch: 'missing' }])).toEqual([]);
  });
});
