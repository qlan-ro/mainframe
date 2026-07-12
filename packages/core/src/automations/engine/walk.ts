// packages/core/src/automations/engine/walk.ts
//
// Linear step walker (contract Decision 12). Task 9 extends this to If and
// Repeat blocks; this task only dispatches the four leaf verbs. Persistence
// is injected via `commit` so this stays testable against an in-memory
// checkpoint — interpreter.ts points `commit` at RunStore.patchCheckpoint.
import type { AutomationStep } from '@qlan-ro/mainframe-types';
import type { AutomationCheckpoint, AutomationCheckpointStep } from '../store/types.js';
import type { TokenContext } from '../tokens/substitute.js';
import type { StepOutcome, VerbContext, VerbPorts, WalkResult } from './types.js';

/** Decision 12: run_action can spawn commands/connectors/http; ask_agent has chat side effects. */
const NON_IDEMPOTENT_KINDS = new Set<AutomationStep['kind']>(['run_action', 'ask_agent']);

export interface WalkDeps {
  ports: VerbPorts;
  runId: string;
  signal: AbortSignal;
  /** Applies `mutate` to the persisted checkpoint in one transaction and returns the fresh copy. */
  commit: (mutate: (checkpoint: AutomationCheckpoint) => void) => AutomationCheckpoint;
}

export async function walkSteps(
  steps: AutomationStep[],
  checkpoint: AutomationCheckpoint,
  deps: WalkDeps,
): Promise<WalkResult> {
  let current = checkpoint;
  for (const step of steps) {
    const stepRef = step.id;
    const prior = current.steps[stepRef];

    if (prior?.status === 'succeeded' || prior?.status === 'skipped') continue;
    // Only reachable when the step's `keepGoing` kept the run alive past its own failure.
    if (prior?.status === 'failed') continue;
    // Leaf verbs that wait externally stay parked; they don't re-enter (v1 engine.ts:154-161).
    if (prior?.status === 'waiting') return { type: 'parked' };

    if (NON_IDEMPOTENT_KINDS.has(step.kind)) {
      current = deps.commit((cp) => setStep(cp, stepRef, step, 'running', null, null));
    }

    const ctx: VerbContext = { runId: deps.runId, stepRef, tokens: buildTokenContext(current), signal: deps.signal };
    const outcome = await dispatchVerb(step, deps.ports, ctx);

    if (outcome.type === 'completed') {
      current = deps.commit((cp) => setStep(cp, stepRef, step, 'succeeded', outcome.outputs, null));
      continue;
    }
    if (outcome.type === 'wait') {
      current = deps.commit((cp) => {
        setStep(cp, stepRef, step, 'waiting', null, null);
        cp.wakeAt = outcome.wakeAt;
      });
      return { type: 'parked' };
    }

    current = deps.commit((cp) => setStep(cp, stepRef, step, 'failed', null, outcome.error));
    if (!step.keepGoing) return { type: 'failed', error: outcome.error };
  }
  return { type: 'done' };
}

async function dispatchVerb(step: AutomationStep, ports: VerbPorts, ctx: VerbContext): Promise<StepOutcome> {
  switch (step.kind) {
    case 'ask_agent':
      return ports.askAgent(step, ctx);
    case 'ask_me':
      return ports.askMe(step, ctx);
    case 'run_action':
      return ports.runAction(step, ctx);
    case 'notify':
      return ports.notify(step, ctx);
    case 'if':
    case 'repeat':
      return { type: 'failed', error: `step kind '${step.kind}' is not implemented yet` };
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
 * Trigger tokens are exposed flat under `ctx.trigger` (contract: `{stepId:
 * 'trigger', output:'payload', field:...}` for webhooks digs into a nested
 * object; `{output:'result'}` for event triggers resolves directly). The
 * trigger handlers (Task 21-22) populate `checkpoint.trigger.payload` in
 * whichever shape their trigger kind's tokens need.
 */
function buildTokenContext(checkpoint: AutomationCheckpoint): TokenContext {
  return {
    trigger: (checkpoint.trigger.payload as Record<string, unknown> | undefined) ?? {},
    steps: checkpoint.steps,
    currentItems: [],
  };
}
