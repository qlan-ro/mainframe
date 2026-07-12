// packages/core/src/automations/engine/interpreter.ts
//
// Serialized per-run advance loop (port of v1 workflows/engine/engine.ts:48-96,
// contract §2 Decision 12). One AutomationInterpreter instance owns the
// in-flight map across all runs; advance() is safe to call repeatedly (wake,
// boot reconcile, retry) — concurrent calls for the same runId share one
// promise so a step never executes twice from a race.
import type { Logger } from 'pino';
import type {
  AutomationDefinition,
  AutomationRunStatus,
  AutomationRunSummary,
  DaemonEvent,
} from '@qlan-ro/mainframe-types';
import type { RunStore } from '../store/run-store.js';
import type { AutomationRunRecord, AutomationRunTriggerContext } from '../store/types.js';
import { walkSteps } from './walk.js';
import type { VerbPorts, WalkResult } from './types.js';

export interface InterpreterDeps {
  store: RunStore;
  ports: VerbPorts;
  emitEvent: (event: DaemonEvent) => void;
  logger: Logger;
  onRunFinalized?: (runId: string) => void | Promise<void>;
}

const TERMINAL_STATUSES: ReadonlySet<AutomationRunStatus> = new Set(['succeeded', 'failed', 'cancelled']);

export class AutomationInterpreter {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly aborts = new Map<string, AbortController>();

  constructor(private readonly deps: InterpreterDeps) {}

  startRun(
    automationId: string,
    definition: AutomationDefinition,
    trigger: AutomationRunTriggerContext,
    dedupKey: string | null,
  ): AutomationRunRecord {
    const run = this.deps.store.createRun(automationId, definition, trigger, dedupKey);
    this.emitRun(run.id);
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

  async cancelRun(runId: string): Promise<void> {
    this.aborts.get(runId)?.abort();
    this.deps.store.finalizeRun(runId, 'cancelled', null);
    this.emitRun(runId);
    await this.deps.onRunFinalized?.(runId);
  }

  private async advanceInner(runId: string): Promise<void> {
    const run = this.deps.store.getRun(runId);
    if (!run || TERMINAL_STATUSES.has(run.status)) return;

    const abort = new AbortController();
    this.aborts.set(runId, abort);
    try {
      const result = await this.walk(run, abort.signal);
      if (result.type === 'parked') {
        this.emitRun(runId);
        return;
      }
      if (result.type === 'failed') {
        this.deps.store.finalizeRun(runId, 'failed', result.error);
      } else {
        this.deps.store.finalizeRun(runId, 'succeeded', null);
      }
      this.emitRun(runId);
      await this.deps.onRunFinalized?.(runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.error({ err, runId }, 'automation advance crashed');
      this.deps.store.finalizeRun(runId, 'failed', message);
      this.emitRun(runId);
      await this.deps.onRunFinalized?.(runId);
    } finally {
      this.aborts.delete(runId);
    }
  }

  private walk(run: AutomationRunRecord, signal: AbortSignal): Promise<WalkResult> {
    return walkSteps(run.checkpoint.definition.steps, run.checkpoint, {
      ports: this.deps.ports,
      runId: run.id,
      signal,
      commit: (mutate) =>
        this.deps.store.patchCheckpoint(run.id, (checkpoint) => {
          mutate(checkpoint);
          return checkpoint;
        }).checkpoint,
    });
  }

  private emitRun(runId: string): void {
    const run = this.deps.store.getRun(runId);
    if (!run) return;
    this.deps.emitEvent({ type: 'automation.run.updated', run: toRunSummary(run) });
  }
}

function toRunSummary(run: AutomationRunRecord): AutomationRunSummary {
  return {
    id: run.id,
    automationId: run.automationId,
    status: run.status,
    trigger: { kind: run.checkpoint.trigger.kind },
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.checkpoint.error,
  };
}
