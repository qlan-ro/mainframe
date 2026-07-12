// packages/core/src/automations/engine/walk.ts
//
// Linear step walker + If/Repeat blocks (Task 9, contract Decision 3, 8, 12).
// Persistence is injected via `commit` so this stays testable against an
// in-memory checkpoint — interpreter.ts points `commit` at
// RunStore.patchCheckpoint. If/Repeat never write a checkpoint entry under
// their own id — only leaf verbs do — so re-entering a block on resume is
// always safe: its nested walk short-circuits on already-terminal steps.
import type {
  AskAgentStep,
  AskMeStep,
  AutomationStep,
  IfBlock,
  NotifyStep,
  RepeatBlock,
  RunActionStep,
} from '@qlan-ro/mainframe-types';
import type { AutomationCheckpoint, AutomationCheckpointStep } from '../store/types.js';
import type { TokenContext } from '../tokens/substitute.js';
import { resolveToken } from '../tokens/substitute.js';
import { evalConditions } from './comparators.js';
import type { StepOutcome, VerbContext, VerbPorts, WalkResult } from './types.js';

/** Contract §2: an unbounded Repeat rewrites the whole checkpoint JSON per advance() (O(N^2)); cap fan-out instead of discovering it in production. */
export const MAX_REPEAT_ITEMS = 500;

type LeafStep = AskAgentStep | AskMeStep | RunActionStep | NotifyStep;

/** Decision 12: run_action can spawn commands/connectors/http; ask_agent has chat side effects. */
const NON_IDEMPOTENT_KINDS = new Set<AutomationStep['kind']>(['run_action', 'ask_agent']);

export interface WalkDeps {
  ports: VerbPorts;
  runId: string;
  signal: AbortSignal;
  /** Applies `mutate` to the persisted checkpoint in one transaction and returns the fresh copy. */
  commit: (mutate: (checkpoint: AutomationCheckpoint) => void) => AutomationCheckpoint;
}

/** Per-scope walk context: `refSuffix` turns a plain step id into its checkpoint stepRef (Decision 3, chained for nested Repeats); `currentItems` is the Repeat iteration stack `current` resolves against. */
interface WalkFrame {
  refSuffix: string;
  currentItems: unknown[];
}

interface StepsResult {
  result: WalkResult;
  checkpoint: AutomationCheckpoint;
}

const TOP_FRAME: WalkFrame = { refSuffix: '', currentItems: [] };

export async function walkSteps(
  steps: AutomationStep[],
  checkpoint: AutomationCheckpoint,
  deps: WalkDeps,
): Promise<WalkResult> {
  return (await walkFrame(steps, checkpoint, deps, TOP_FRAME)).result;
}

async function walkFrame(
  steps: AutomationStep[],
  checkpoint: AutomationCheckpoint,
  deps: WalkDeps,
  frame: WalkFrame,
): Promise<StepsResult> {
  let current = checkpoint;
  for (const step of steps) {
    const stepRef = step.id + frame.refSuffix;
    const prior = current.steps[stepRef];
    if (prior?.status === 'succeeded' || prior?.status === 'skipped' || prior?.status === 'failed') continue;
    if (prior?.status === 'waiting') return { result: { type: 'parked' }, checkpoint: current };

    const outcome = await runStep(step, stepRef, current, deps, frame);
    current = outcome.checkpoint;
    if (outcome.result.type === 'parked') return outcome;
    if (outcome.result.type === 'failed' && !step.keepGoing) return outcome;
  }
  return { result: { type: 'done' }, checkpoint: current };
}

async function runStep(
  step: AutomationStep,
  stepRef: string,
  checkpoint: AutomationCheckpoint,
  deps: WalkDeps,
  frame: WalkFrame,
): Promise<StepsResult> {
  if (step.kind === 'if') return runIf(step, checkpoint, deps, frame);
  if (step.kind === 'repeat') return runRepeat(step, checkpoint, deps, frame);
  return runLeaf(step, stepRef, checkpoint, deps, frame);
}

async function runIf(
  step: IfBlock,
  checkpoint: AutomationCheckpoint,
  deps: WalkDeps,
  frame: WalkFrame,
): Promise<StepsResult> {
  const tokens = buildTokenContext(checkpoint, frame);
  const matched = evalConditions(step.conditions, step.match, tokens);
  return walkFrame(matched ? step.then : step.otherwise, checkpoint, deps, frame);
}

async function runRepeat(
  step: RepeatBlock,
  checkpoint: AutomationCheckpoint,
  deps: WalkDeps,
  frame: WalkFrame,
): Promise<StepsResult> {
  const tokens = buildTokenContext(checkpoint, frame);
  const items = resolveToken(tokens, step.items);
  if (!Array.isArray(items)) {
    return {
      result: { type: 'failed', error: `repeat '${step.id}' items token did not resolve to a list` },
      checkpoint,
    };
  }
  if (items.length > MAX_REPEAT_ITEMS) {
    return {
      result: { type: 'failed', error: `list has ${items.length} items, exceeds the ${MAX_REPEAT_ITEMS}-item limit` },
      checkpoint,
    };
  }

  let current = checkpoint;
  for (let i = 0; i < items.length; i++) {
    const iterFrame: WalkFrame = {
      refSuffix: `${frame.refSuffix}#${i}`,
      currentItems: [...frame.currentItems, items[i]],
    };
    const outcome = await walkFrame(step.steps, current, deps, iterFrame);
    current = outcome.checkpoint;
    if (outcome.result.type !== 'done') return outcome;
  }
  return { result: { type: 'done' }, checkpoint: current };
}

async function runLeaf(
  step: LeafStep,
  stepRef: string,
  checkpoint: AutomationCheckpoint,
  deps: WalkDeps,
  frame: WalkFrame,
): Promise<StepsResult> {
  let current = checkpoint;
  if (NON_IDEMPOTENT_KINDS.has(step.kind)) {
    current = deps.commit((cp) => setStep(cp, stepRef, step, 'running', null, null));
  }

  const ctx: VerbContext = {
    runId: deps.runId,
    stepRef,
    tokens: buildTokenContext(current, frame),
    signal: deps.signal,
  };
  const outcome = await dispatchVerb(step, deps.ports, ctx);

  if (outcome.type === 'completed') {
    current = deps.commit((cp) => setStep(cp, stepRef, step, 'succeeded', outcome.outputs, null));
    return { result: { type: 'done' }, checkpoint: current };
  }
  if (outcome.type === 'wait') {
    current = deps.commit((cp) => {
      setStep(cp, stepRef, step, 'waiting', null, null);
      cp.wakeAt = outcome.wakeAt;
    });
    return { result: { type: 'parked' }, checkpoint: current };
  }
  current = deps.commit((cp) => setStep(cp, stepRef, step, 'failed', null, outcome.error));
  return { result: { type: 'failed', error: outcome.error }, checkpoint: current };
}

async function dispatchVerb(step: LeafStep, ports: VerbPorts, ctx: VerbContext): Promise<StepOutcome> {
  switch (step.kind) {
    case 'ask_agent':
      return ports.askAgent(step, ctx);
    case 'ask_me':
      return ports.askMe(step, ctx);
    case 'run_action':
      return ports.runAction(step, ctx);
    case 'notify':
      return ports.notify(step, ctx);
  }
}

function setStep(
  checkpoint: AutomationCheckpoint,
  stepRef: string,
  step: AutomationStep,
  status: AutomationCheckpointStep['status'],
  outputs: Record<string, unknown> | null,
  error: string | null,
): void {
  const existing = checkpoint.steps[stepRef];
  const now = Date.now();
  const terminal = status === 'succeeded' || status === 'failed' || status === 'skipped';
  checkpoint.steps[stepRef] = {
    stepId: step.id,
    kind: step.kind,
    status,
    outputs: status === 'succeeded' ? outputs : (existing?.outputs ?? null),
    error,
    startedAt: existing?.startedAt ?? now,
    finishedAt: terminal ? now : null,
  };
}

/**
 * Trigger tokens are exposed flat under `ctx.trigger`. `ctx.steps` merges the
 * outer scope's plain-id keys with this frame's own iteration keyed by their
 * plain id too (tokens/substitute.ts docstring: lookups are always by plain
 * stepId, never the suffixed stepRef) — see `stepsView`.
 */
function buildTokenContext(checkpoint: AutomationCheckpoint, frame: WalkFrame): TokenContext {
  return {
    trigger: (checkpoint.trigger.payload as Record<string, unknown> | undefined) ?? {},
    steps: stepsView(checkpoint, frame.refSuffix),
    currentItems: frame.currentItems,
  };
}

/** Overlays this frame's own suffixed entries (e.g. `send#0`) under their plain id, without leaking deeper-nested Repeat entries (e.g. `inner#0#1`) into a shallower scope. */
function stepsView(checkpoint: AutomationCheckpoint, refSuffix: string): Record<string, AutomationCheckpointStep> {
  if (refSuffix === '') return checkpoint.steps;
  const view: Record<string, AutomationCheckpointStep> = { ...checkpoint.steps };
  for (const [ref, entry] of Object.entries(checkpoint.steps)) {
    if (!ref.endsWith(refSuffix)) continue;
    const plainId = ref.slice(0, -refSuffix.length);
    if (!plainId.includes('#')) view[plainId] = entry;
  }
  return view;
}
