import type { Logger } from 'pino';
import type { CallStep, StepDef, WorkflowDef } from '../../dsl/types.js';
import type { RunStore } from '../../store/run-store.js';
import type { WorkflowEngine } from '../engine.js';
import type { StepContext, StepOutcome } from '../types.js';
import { renderValue } from '../../template/render.js';

export type WorkflowLookup = (name: string) => { id: string; definition: WorkflowDef | object } | null;

const MAX_DEPTH = 3;

export class CallCoordinator {
  private engine: WorkflowEngine | null = null;

  constructor(
    private readonly store: RunStore,
    private readonly lookup: WorkflowLookup,
    private readonly logger: Logger,
  ) {}

  bindEngine(engine: WorkflowEngine): void {
    this.engine = engine;
  }

  resolve(name: string): { id: string; definition: WorkflowDef | object } | null {
    return this.lookup(name);
  }

  getRunStatus(runId: string): string | null {
    return this.store.getRun(runId)?.status ?? null;
  }

  getRunOutputs(runId: string): unknown {
    return this.store.getRun(runId)?.outputs ?? null;
  }

  getRunError(runId: string): string | null {
    return this.store.getRun(runId)?.error ?? null;
  }

  /** Walk the parent chain to determine nesting depth of the given run. */
  depthOf(runId: string): number {
    let depth = 0;
    let current = this.store.getRun(runId);
    while (current?.parentRunId) {
      depth += 1;
      current = this.store.getRun(current.parentRunId);
    }
    return depth;
  }

  /**
   * Start the child run and drive it to completion (or until it parks).
   * Awaiting this ensures the child's step rows are committed before the
   * executor decides whether to wait or return inline.
   */
  async startChild(args: {
    name: string;
    inputs: Record<string, unknown>;
    parentRunId: string;
    parentStepPath: string;
  }): Promise<{ childRunId: string }> {
    if (!this.engine) throw new Error('coordinator not bound to engine');
    const target = this.resolve(args.name);
    if (!target) throw new Error(`unknown workflow '${args.name}'`);
    const child = this.engine.startRun({
      workflowId: target.id,
      definition: target.definition,
      triggerKind: 'call',
      triggerPayload: null,
      inputs: args.inputs,
      parentRunId: args.parentRunId,
      parentStepPath: args.parentStepPath,
    });
    // Await so the child is fully driven before the executor inspects its status.
    // onRunFinalized fires during this await; the parent step isn't committed yet
    // so it's a harmless no-op — the executor handles the inline completion below.
    await this.engine.advance(child.id);
    return { childRunId: child.id };
  }

  /**
   * Waker for async child completions: if a child that was previously parked
   * (e.g. waiting on an agent) later finalizes, this propagates its result to
   * the waiting parent step and re-advances the parent.
   */
  async onRunFinalized(childRunId: string): Promise<void> {
    if (!this.engine) return;
    const child = this.store.getRun(childRunId);
    if (!child?.parentRunId || !child.parentStepPath) return;
    const latest = this.store.latestStepResults(child.parentRunId).get(child.parentStepPath);
    // Only act when the parent step is actually waiting (async child case).
    if (!latest || latest.status !== 'waiting') return;
    if (child.status === 'succeeded') {
      this.store.commitStep(child.parentRunId, {
        stepPath: child.parentStepPath,
        stepId: latest.stepId,
        kind: 'call',
        attempt: latest.attempt,
        status: 'succeeded',
        input: null,
        output: child.outputs ?? {},
        scratch: latest.scratch,
        error: null,
      });
    } else {
      this.store.commitStep(child.parentRunId, {
        stepPath: child.parentStepPath,
        stepId: latest.stepId,
        kind: 'call',
        attempt: latest.attempt,
        status: 'failed',
        input: null,
        output: null,
        scratch: latest.scratch,
        error: `sub-workflow ${child.status}: ${child.error ?? ''}`,
      });
    }
    await this.engine.advance(child.parentRunId);
  }
}

export function makeCallExecutor(coordinator: CallCoordinator) {
  return async function executeCall(ctx: StepContext, rawStep: StepDef): Promise<StepOutcome> {
    const step = rawStep as CallStep;
    const scratch = ctx.prior?.scratch as { childRunId?: string } | null;
    // Re-entry after an async wake: child was previously parked, now done.
    if (scratch?.childRunId) {
      return { type: 'wait', wait: { kind: 'call', wakeAt: null }, scratch: { childRunId: scratch.childRunId } };
    }
    if (coordinator.depthOf(ctx.run.id) >= MAX_DEPTH) {
      return {
        type: 'failed',
        error: `sub-workflow depth cap (${MAX_DEPTH}) exceeded`,
        retryable: false,
      };
    }
    if (!coordinator.resolve(step.call)) {
      return { type: 'failed', error: `unknown workflow '${step.call}'`, retryable: false };
    }
    const inputs = (await renderValue(step.with ?? {}, ctx.scope)) as Record<string, unknown>;
    const { childRunId } = await coordinator.startChild({
      name: step.call,
      inputs,
      parentRunId: ctx.run.id,
      parentStepPath: ctx.stepPath,
    });
    // Inspect the child's final status inline — if it completed synchronously,
    // return the result immediately without parking the parent.
    const childStatus = coordinator.getRunStatus(childRunId);
    if (childStatus === 'succeeded') {
      return { type: 'completed', output: coordinator.getRunOutputs(childRunId) ?? {} };
    }
    if (childStatus === 'failed' || childStatus === 'cancelled') {
      return {
        type: 'failed',
        error: `sub-workflow '${step.call}' ${childStatus}: ${coordinator.getRunError(childRunId) ?? ''}`,
        retryable: false,
      };
    }
    // Child is still running/waiting (e.g. it has agent or human steps).
    return { type: 'wait', wait: { kind: 'call', wakeAt: null }, scratch: { childRunId } };
  };
}
