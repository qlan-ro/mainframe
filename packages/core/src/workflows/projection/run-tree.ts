// packages/core/src/workflows/projection/run-tree.ts
import type { WorkflowDef, StepDef } from '../dsl/types.js';
import type { StepRunRecord, StepStatus } from '../store/types.js';
import { stepKind } from '../dsl/types.js';

export interface RunTreeNode {
  stepPath: string;
  stepId: string | null;
  kind: string;
  status: string;
  attempt: number;
  input: unknown;
  output: unknown;
  error: string | null;
  chatId?: string;
  duration?: string; // leaf — formatted elapsed time
  waitFor?: string; // leaf — what a waiting step is blocked on
  // composite children shaped to match the design:
  lanes?: Array<{ label: string; status: string; steps: RunTreeNode[] }>; // parallel
  arms?: Array<{ cond: string; taken: boolean; steps: RunTreeNode[] }>; // choose
  iterations?: Array<{ label: string; status: string; steps: RunTreeNode[] }>; // foreach
  ref?: string; // call
  childRunId?: string; // call
  steps?: RunTreeNode[]; // call subflow
  summary?: string; // composite — daemon-supplied rollup line (e.g. "1 of 2")
}

/** Worst-of rollup ordering — highest severity first. */
const STATUS_RANK: Record<string, number> = {
  failed: 6,
  ambiguous: 5,
  waiting: 4,
  running: 3,
  skipped: 2,
  succeeded: 1,
  pending: 0,
};

/** Returns the worst (highest-rank) status across a set of child steps. */
function rollupStatuses(statuses: string[]): string {
  if (statuses.length === 0) return 'pending';
  let worst = 'pending';
  let worstRank = -1;
  for (const s of statuses) {
    const rank = STATUS_RANK[s] ?? 0;
    if (rank > worstRank) {
      worstRank = rank;
      worst = s;
    }
  }
  return worst;
}

/** Compute rollup status for a branch prefix (e.g. a parallel lane or foreach iteration). */
function rollup(latest: Map<string, StepRunRecord>, prefix: string): string {
  const statuses: string[] = [];
  for (const [path, rec] of latest.entries()) {
    if (path.startsWith(prefix + '.') || path === prefix) {
      statuses.push(rec.status);
    }
  }
  return rollupStatuses(statuses);
}

/** Read per-iteration labels from the loop step's scratch. */
function iterationsOf(rec: StepRunRecord | undefined): Array<{ index: number; label: string }> {
  if (!rec?.scratch) return [];
  const s = rec.scratch as { iterations?: Array<{ index: number; label: string }> };
  return s.iterations ?? [];
}

/** Format an elapsed millisecond span as "Xm Ys" (or "Ys" under a minute). */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Derive the leaf-only duration/waitFor fields from the step's run record. */
function leafFields(
  rec: StepRunRecord | undefined,
  scratch: Record<string, unknown> | null,
  isComposite: boolean,
): Pick<RunTreeNode, 'duration' | 'waitFor'> {
  const fields: Pick<RunTreeNode, 'duration' | 'waitFor'> = {};
  if (isComposite) return fields;
  if (rec?.startedAt !== undefined && rec.finishedAt != null) {
    fields.duration = formatDuration(rec.finishedAt - rec.startedAt);
  }
  if (rec?.status === 'waiting') {
    const waitFor = (scratch as { waitFor?: string } | null)?.waitFor;
    if (waitFor !== undefined) fields.waitFor = waitFor;
  }
  return fields;
}

/** Derive the composite `summary` rollup line for a parallel/choose/foreach/call node. */
function compositeSummary(step: StepDef, base: RunTreeNode, takenArm: number): string | undefined {
  if ('parallel' in step) {
    const total = base.lanes!.length;
    const done = base.lanes!.filter((l) => l.status === 'succeeded').length;
    return `${done} of ${total}`;
  }
  if ('choose' in step) {
    return takenArm >= 0 ? base.arms![takenArm]!.cond : 'not taken';
  }
  if ('foreach' in step) {
    return `${base.iterations!.length} items`;
  }
  if ('call' in step) {
    return step.call;
  }
  return undefined;
}

function buildNode(step: StepDef, path: string, latest: Map<string, StepRunRecord>): RunTreeNode {
  const rec = latest.get(path);
  const kind = stepKind(step);
  const scratch = rec?.scratch ?? null;
  const isComposite = 'parallel' in step || 'choose' in step || 'foreach' in step || 'call' in step;
  const base: RunTreeNode = {
    stepPath: path,
    stepId: step.id ?? null,
    kind,
    status: rec?.status ?? 'pending',
    attempt: rec?.attempt ?? 0,
    input: rec?.input ?? null,
    output: rec?.output ?? null,
    error: rec?.error ?? null,
    chatId: (scratch as { chatId?: string } | null)?.chatId,
    ...leafFields(rec, scratch, isComposite),
  };

  let takenArm = -1;
  if ('parallel' in step) {
    base.lanes = buildParallelLanes(step.parallel, path, latest);
  } else if ('choose' in step) {
    takenArm = (scratch as { takenArm?: number } | null)?.takenArm ?? -1;
    base.arms = buildChooseArms(step.choose, path, scratch, latest);
  } else if ('foreach' in step) {
    base.iterations = buildForeachIterations(step, path, rec, latest);
  } else if ('call' in step) {
    base.ref = step.call;
    base.childRunId = (scratch as { childRunId?: string } | null)?.childRunId;
  }

  if (isComposite) {
    base.summary = compositeSummary(step, base, takenArm);
  }

  return base;
}

function buildParallelLanes(
  parallel: Record<string, StepDef[]>,
  path: string,
  latest: Map<string, StepRunRecord>,
): Array<{ label: string; status: string; steps: RunTreeNode[] }> {
  return Object.entries(parallel).map(([label, steps]) => {
    const lanePrefix = `${path}.parallel.${label}`;
    return {
      label,
      status: rollup(latest, lanePrefix),
      steps: walkSteps(steps, lanePrefix, latest),
    };
  });
}

function buildChooseArms(
  arms: Array<{ when?: string; else?: boolean; steps: StepDef[] }>,
  path: string,
  scratch: Record<string, unknown> | null,
  latest: Map<string, StepRunRecord>,
): Array<{ cond: string; taken: boolean; steps: RunTreeNode[] }> {
  const takenArm = (scratch as { takenArm?: number } | null)?.takenArm ?? -1;
  return arms.map((arm, a) => ({
    cond: arm.else ? 'else' : String(arm.when),
    taken: a === takenArm,
    steps: a === takenArm ? walkSteps(arm.steps, `${path}.choose.${a}.steps`, latest) : [],
  }));
}

function buildForeachIterations(
  step: { foreach: string; steps: StepDef[] },
  path: string,
  rec: StepRunRecord | undefined,
  latest: Map<string, StepRunRecord>,
): Array<{ label: string; status: string; steps: RunTreeNode[] }> {
  const iters = iterationsOf(rec);
  return iters.map(({ index, label }) => {
    const iterPrefix = `${path}#${index}.steps`;
    return {
      label,
      status: rollup(latest, iterPrefix),
      steps: walkSteps(step.steps, iterPrefix, latest),
    };
  });
}

function walkSteps(steps: StepDef[], prefix: string, latest: Map<string, StepRunRecord>): RunTreeNode[] {
  return steps.map((step, i) => buildNode(step, `${prefix}.${i}`, latest));
}

/** Zip a workflow definition with its flat step_run records into a nested tree. */
export function buildRunTree(def: WorkflowDef, latest: Map<string, StepRunRecord>): RunTreeNode[] {
  return walkSteps(def.steps, 'steps', latest);
}
