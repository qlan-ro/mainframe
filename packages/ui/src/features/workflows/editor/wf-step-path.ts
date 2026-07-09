/**
 * wf-step-path — immutable get/patch/insert/remove helpers over a step tree,
 * addressed by `WfStepPath` (see `./config/wf-scope` for the encoding).
 *
 * Mirrors `descriptor-types.ts`'s `setByPath` clone-only-the-spine style, but
 * over the step tree/array instead of a single object: only the touched list
 * and each composite step object between root and the target are cloned;
 * every untouched sibling step/arm/branch keeps its original reference.
 * Invalid paths (out-of-range index, mismatched selector token) never throw —
 * they return `[]` (reads) or the original `root` unchanged (writes).
 */
import type { WfStep, WfArm } from './wf-draft-types';
import type { WfStepPath } from './config/wf-scope';

type ListUpdater = (list: WfStep[]) => WfStep[] | undefined;

/** Read-only walk: resolves `path` to the step list it addresses, or `[]` if invalid. */
export function getStepsAtPath(root: WfStep[], path: WfStepPath): WfStep[] {
  let steps: WfStep[] = root;
  let i = 0;
  while (i < path.length) {
    const selector = path[i];
    if (typeof selector !== 'number') return [];
    const step = steps[selector];
    if (!step) return [];
    i++;
    if (i >= path.length) return step.kind === 'foreach' ? step.steps : [];
    if (step.kind === 'foreach') {
      steps = step.steps;
      continue;
    }
    const token = path[i];
    if (token === undefined || typeof token === 'number') return [];
    const child = childListFor(step, token);
    if (!child) return [];
    steps = child;
    i++;
  }
  return steps;
}

function childListFor(step: WfStep, token: { arm: number } | { branch: string }): WfStep[] | undefined {
  if (step.kind === 'choose' && 'arm' in token) return step.arms[token.arm]?.steps;
  if (step.kind === 'parallel' && 'branch' in token) return step.branches[token.branch];
  return undefined;
}

/** Clone-only-the-spine walk: applies `update` to the list addressed by `path`, or `undefined` if invalid. */
function walkAndUpdate(list: WfStep[], path: WfStepPath, i: number, update: ListUpdater): WfStep[] | undefined {
  if (i >= path.length) return update(list);

  const selector = path[i];
  if (typeof selector !== 'number') return undefined;
  const step = list[selector];
  if (!step) return undefined;

  if (i + 1 >= path.length) {
    if (step.kind !== 'foreach') return undefined;
    return replaceForeachSteps(list, selector, step, update(step.steps));
  }
  if (step.kind === 'foreach') {
    return replaceForeachSteps(list, selector, step, walkAndUpdate(step.steps, path, i + 1, update));
  }

  const token = path[i + 1];
  if (token === undefined || typeof token === 'number') return undefined;
  if (step.kind === 'choose' && 'arm' in token) return descendArm(list, selector, step, token.arm, path, i, update);
  if (step.kind === 'parallel' && 'branch' in token) {
    return descendBranch(list, selector, step, token.branch, path, i, update);
  }
  return undefined;
}

function replaceForeachSteps(
  list: WfStep[],
  idx: number,
  step: Extract<WfStep, { kind: 'foreach' }>,
  newSteps: WfStep[] | undefined,
): WfStep[] | undefined {
  if (newSteps === undefined) return undefined;
  if (newSteps === step.steps) return list;
  const newList = list.slice();
  newList[idx] = { ...step, steps: newSteps };
  return newList;
}

function descendArm(
  list: WfStep[],
  idx: number,
  step: Extract<WfStep, { kind: 'choose' }>,
  armIdx: number,
  path: WfStepPath,
  i: number,
  update: ListUpdater,
): WfStep[] | undefined {
  const arm = step.arms[armIdx];
  if (!arm) return undefined;
  const newArmSteps = walkAndUpdate(arm.steps, path, i + 2, update);
  if (newArmSteps === undefined) return undefined;
  if (newArmSteps === arm.steps) return list;
  const newArms = step.arms.slice();
  const newArm: WfArm = { ...arm, steps: newArmSteps };
  newArms[armIdx] = newArm;
  const newList = list.slice();
  newList[idx] = { ...step, arms: newArms };
  return newList;
}

function descendBranch(
  list: WfStep[],
  idx: number,
  step: Extract<WfStep, { kind: 'parallel' }>,
  branchName: string,
  path: WfStepPath,
  i: number,
  update: ListUpdater,
): WfStep[] | undefined {
  const branchList = step.branches[branchName];
  if (!branchList) return undefined;
  const newBranchList = walkAndUpdate(branchList, path, i + 2, update);
  if (newBranchList === undefined) return undefined;
  if (newBranchList === branchList) return list;
  const newBranches = { ...step.branches, [branchName]: newBranchList };
  const newList = list.slice();
  newList[idx] = { ...step, branches: newBranches };
  return newList;
}

/** Appends `step` to the end of the list addressed by `path` (list-addressing, same rules as `getStepsAtPath`). */
export function insertStepAtPath(root: WfStep[], path: WfStepPath, step: WfStep): WfStep[] {
  return walkAndUpdate(root, path, 0, (list) => [...list, step]) ?? root;
}

/** `path` must end in a plain number addressing one step within the preceding list. */
function stepAddress(path: WfStepPath): { listPath: WfStepPath; idx: number } | undefined {
  const idx = path[path.length - 1];
  if (typeof idx !== 'number') return undefined;
  return { listPath: path.slice(0, -1), idx };
}

/** Immutably merges `patch` into the step addressed by `path`. */
export function patchStepAtPath(root: WfStep[], path: WfStepPath, patch: Partial<WfStep>): WfStep[] {
  const address = stepAddress(path);
  if (!address) return root;
  const { listPath, idx } = address;
  const result = walkAndUpdate(root, listPath, 0, (list) => {
    const target = list[idx];
    if (!target) return undefined;
    const nextList = list.slice();
    nextList[idx] = { ...target, ...patch } as WfStep;
    return nextList;
  });
  return result ?? root;
}

/** Immutably removes the step addressed by `path` from its containing list. */
export function removeStepAtPath(root: WfStep[], path: WfStepPath): WfStep[] {
  const address = stepAddress(path);
  if (!address) return root;
  const { listPath, idx } = address;
  const result = walkAndUpdate(root, listPath, 0, (list) => {
    if (idx < 0 || idx >= list.length) return undefined;
    return list.filter((_, k) => k !== idx);
  });
  return result ?? root;
}
