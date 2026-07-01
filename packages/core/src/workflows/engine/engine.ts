import type { StepDef, WorkflowDef } from '../dsl/types.js';
import { stepKind } from '../dsl/types.js';
import { renderValue } from '../template/render.js';
import type { RunRecord, TriggerKind } from '../store/types.js';
import type { EngineDeps, Scope, StepContext, StepOutcome, WalkResult } from './types.js';
import { bind, rootScope } from './scope.js';
import { makeConnectorExecutor, type CredentialResolver } from './executors/connector.js';
import { decideFailure } from './failure.js';

export class WorkflowEngine {
  readonly store: EngineDeps['store'];
  private readonly deps: EngineDeps;
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly connectorExec: ReturnType<typeof makeConnectorExecutor>;

  constructor(deps: EngineDeps, resolveCredential: CredentialResolver = () => null) {
    this.deps = deps;
    this.store = deps.store;
    this.connectorExec = makeConnectorExecutor(deps.connectors, resolveCredential);
  }

  startRun(args: {
    workflowId: string;
    definition: WorkflowDef | object;
    triggerKind: TriggerKind;
    triggerPayload: unknown;
    inputs: Record<string, unknown>;
    parentRunId?: string;
    parentStepPath?: string;
  }): RunRecord {
    const def = args.definition as WorkflowDef;
    const inputs = { ...args.inputs };
    for (const [name, field] of Object.entries(def.inputs ?? {})) {
      if (inputs[name] === undefined && field.default !== undefined) inputs[name] = field.default;
      if (inputs[name] === undefined && field.required !== false) {
        throw new Error(`required input '${name}' missing for workflow '${def.name}'`);
      }
    }
    const run = this.store.createRun({ ...args, inputs });
    this.deps.emitEvent({ type: 'workflow.run.updated', run: toRunSummary(run) } as never);
    return run;
  }

  /** Serialized per-run entry point. Safe to call repeatedly (wake, boot, retry). */
  advance(runId: string): Promise<void> {
    const existing = this.inFlight.get(runId);
    if (existing) return existing;
    const p = this.advanceInner(runId).finally(() => this.inFlight.delete(runId));
    this.inFlight.set(runId, p);
    return p;
  }

  private async advanceInner(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run) return;
    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') return;
    this.store.markRunning(runId);
    const abort = new AbortController();
    this.aborts.set(runId, abort);
    try {
      let scope = rootScope(run);
      const vars: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(run.definition.vars ?? {})) {
        vars[k] = await renderValue(v, scope);
      }
      scope = { ...scope, vars };

      const result = await this.walkSequence(run, run.definition.steps, 'steps', scope, abort.signal);
      if (result.type === 'parked') return;
      if (result.type === 'failed') {
        this.store.finalizeRun(runId, 'failed', null, result.error);
      } else {
        const outputs = run.definition.outputs ? await renderValue(run.definition.outputs, result.scope) : null;
        this.store.finalizeRun(runId, 'succeeded', outputs, null);
      }
      this.emitRun(runId);
    } catch (err) {
      this.deps.logger.error({ err, runId }, 'workflow advance crashed');
      this.store.finalizeRun(runId, 'failed', null, String(err instanceof Error ? err.message : err));
      this.emitRun(runId);
    } finally {
      this.aborts.delete(runId);
    }
  }

  async cancelRun(runId: string): Promise<void> {
    this.aborts.get(runId)?.abort();
    this.store.finalizeRun(runId, 'cancelled', null, null);
    this.emitRun(runId);
  }

  /** Walk one step list. Committed results bind and skip; first live step executes. */
  private async walkSequence(
    run: RunRecord,
    steps: StepDef[],
    pathPrefix: string,
    scope: Scope,
    signal: AbortSignal,
  ): Promise<WalkResult> {
    const committed = this.store.latestStepResults(run.id);
    let current = scope;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as StepDef;
      const stepPath = `${pathPrefix}.${i}`;
      const prior = committed.get(stepPath) ?? null;

      if (prior?.status === 'succeeded') {
        current = bind(current, step.id, prior.output);
        continue;
      }
      if (prior?.status === 'skipped') {
        current = bind(current, step.id, null);
        continue;
      }
      if (prior?.status === 'failed' && (step.on_failure ?? 'fail') === 'continue') {
        current = bind(current, step.id, null);
        continue;
      }
      if (prior?.status === 'failed') {
        return { type: 'failed', error: prior.error ?? 'step failed' };
      }
      if (prior?.status === 'waiting') {
        // Block kinds re-enter; leaf kinds that wait externally stay parked.
        const k = stepKind(step);
        if (k !== 'choose' && k !== 'foreach' && k !== 'parallel') {
          return { type: 'parked' };
        }
        // fall through to re-execute the block
      }

      const exec = await this.executeWithRetry(run, step, stepPath, current, prior?.attempt ?? 0, signal);
      if (exec.type === 'parked' || exec.type === 'failed') return exec;
      current = bind(
        current,
        step.id,
        (exec as { scope: Scope }).scope[step.id]
          ? ((exec as { scope: Scope }).scope[step.id] as { output: unknown }).output
          : null,
      );
    }
    return { type: 'done', scope: current };
  }

  private async executeWithRetry(
    run: RunRecord,
    step: StepDef,
    stepPath: string,
    scope: Scope,
    priorAttempts: number,
    signal: AbortSignal,
  ): Promise<WalkResult & { scope: Scope }> {
    const kind = stepKind(step);
    let attempt = priorAttempts;
    for (;;) {
      attempt += 1;
      const ctx: StepContext = {
        run,
        stepPath,
        attempt,
        scope,
        prior: this.store.getStepRun(run.id, stepPath, attempt),
        logger: this.deps.logger.child({ runId: run.id, stepPath }),
        signal,
      };
      const outcome = await this.executeStep(ctx, step, signal);

      if (outcome.type === 'completed') {
        this.store.commitStep(run.id, {
          stepPath,
          stepId: step.id,
          kind,
          attempt,
          status: 'succeeded',
          input: null,
          output: outcome.output,
          scratch: null,
          error: null,
        });
        this.emitStep(run.id, stepPath);
        const newScope = bind(scope, step.id, outcome.output);
        return { type: 'done', scope: newScope };
      }

      if (outcome.type === 'wait') {
        this.store.commitStep(run.id, {
          stepPath,
          stepId: step.id,
          kind,
          attempt,
          status: 'waiting',
          input: null,
          output: null,
          scratch: outcome.scratch ?? null,
          error: null,
        });
        this.store.parkRun(run.id, outcome.wait.wakeAt);
        this.emitStep(run.id, stepPath);
        this.emitRun(run.id);
        return { type: 'parked', scope };
      }

      // failed
      const decision = decideFailure(step, attempt, outcome);
      this.store.commitStep(run.id, {
        stepPath,
        stepId: step.id,
        kind,
        attempt,
        status: 'failed',
        input: null,
        output: null,
        scratch: null,
        error: outcome.error,
      });
      this.emitStep(run.id, stepPath);

      if (decision.kind === 'retry') {
        await new Promise<void>((r) => setTimeout(r, decision.delayMs));
        continue;
      }
      if (decision.kind === 'continue') {
        return { type: 'done', scope: bind(scope, step.id, null) };
      }
      return { type: 'failed', error: outcome.error, scope };
    }
  }

  private async executeStep(ctx: StepContext, step: StepDef, signal: AbortSignal): Promise<StepOutcome> {
    const kind = stepKind(step);
    switch (kind) {
      case 'set': {
        const value = await renderValue((step as { set: Record<string, unknown> }).set, ctx.scope);
        return { type: 'completed', output: value };
      }
      case 'connector':
        return this.connectorExec(ctx, step as never);
      case 'choose':
      case 'foreach':
      case 'parallel':
        return this.executeBlock(ctx, step, kind, signal);
      case 'agent':
      case 'question':
      case 'call': {
        const exec = this.deps.executors[kind];
        if (!exec) {
          return {
            type: 'failed',
            error: `no executor registered for step kind '${kind}'`,
            retryable: false,
          };
        }
        return exec(ctx, step);
      }
    }
  }

  // Placeholder — implemented in Tasks 9-11 (choose/foreach/parallel).
  protected async executeBlock(
    _ctx: StepContext,
    _step: StepDef,
    kind: string,
    _signal: AbortSignal,
  ): Promise<StepOutcome> {
    return { type: 'failed', error: `block kind '${kind}' not implemented yet`, retryable: false };
  }

  // Exposed for Tasks 9-11 to recurse into nested sequences.
  protected walkNested(
    run: RunRecord,
    steps: StepDef[],
    pathPrefix: string,
    scope: Scope,
    signal: AbortSignal,
  ): Promise<WalkResult> {
    return this.walkSequence(run, steps, pathPrefix, scope, signal);
  }

  emitRun(runId: string): void {
    const run = this.store.getRun(runId);
    if (run) {
      this.deps.emitEvent({ type: 'workflow.run.updated', run: toRunSummary(run) } as never);
    }
  }

  private emitStep(runId: string, stepPath: string): void {
    const latest = this.store.latestStepResults(runId).get(stepPath);
    if (latest) {
      this.deps.emitEvent({
        type: 'workflow.step.updated',
        runId,
        step: {
          stepPath: latest.stepPath,
          stepId: latest.stepId,
          status: latest.status,
          attempt: latest.attempt,
        },
      } as never);
    }
  }
}

export function toRunSummary(run: RunRecord): object {
  return {
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    triggerKind: run.triggerKind,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
    outputs: run.outputs,
  };
}
