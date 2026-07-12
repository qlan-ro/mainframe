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
  AutomationStep,
  DaemonEvent,
} from '@qlan-ro/mainframe-types';
import type { InteractionStore } from '../store/interaction-store.js';
import type { RunStore } from '../store/run-store.js';
import type { AutomationCheckpoint, AutomationRunRecord, AutomationRunTriggerContext } from '../store/types.js';
import { walkSteps } from './walk.js';
import type { VerbPorts, WalkResult } from './types.js';

export interface InterpreterDeps {
  store: RunStore;
  interactions: InteractionStore;
  ports: VerbPorts;
  emitEvent: (event: DaemonEvent) => void;
  logger: Logger;
  onRunFinalized?: (runId: string) => void | Promise<void>;
  /** Decision 12 restart policy: true only for run_action steps safe to blindly re-invoke after an unknown-effect restart. Defaults to false (fail loudly); ask_agent is never restart-safe regardless of this hook. */
  isIdempotent?: (step: AutomationStep) => boolean;
}

const TERMINAL_STATUSES: ReadonlySet<AutomationRunStatus> = new Set(['succeeded', 'failed', 'cancelled']);
const RESTART_MID_ACTION_ERROR = 'engine restarted mid-action; effect unknown';
const AGENT_DEADLINE_ERROR = 'agent step deadline exceeded';

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
    this.deps.interactions.cancelPendingForRun(runId);
    this.emitRun(runId);
    await this.deps.onRunFinalized?.(runId);
  }

  /** Contract Decision 12: fail any waiting ask_agent step whose deadline has passed, then let its own `keepGoing` decide whether the run continues. */
  async sweepDeadlines(now = Date.now()): Promise<void> {
    const due = this.deps.store
      .loadResumable()
      .filter((run) => run.checkpoint.wakeAt !== null && run.checkpoint.wakeAt <= now);
    for (const run of due) await this.failDeadlineStep(run);
  }

  private async advanceInner(runId: string): Promise<void> {
    let run = this.deps.store.getRun(runId);
    if (!run || TERMINAL_STATUSES.has(run.status)) return;

    const fatalStale = this.resolveStaleRunningSteps(run);
    if (fatalStale) {
      await this.finalizeAndEmit(runId, 'failed', fatalStale);
      return;
    }
    run = this.deps.store.getRun(runId)!;

    const abort = new AbortController();
    this.aborts.set(runId, abort);
    try {
      const result = await this.walk(run, abort.signal);
      if (result.type === 'parked') {
        this.emitRun(runId);
        return;
      }
      if (result.type === 'failed') {
        await this.finalizeAndEmit(runId, 'failed', result.error);
      } else {
        await this.finalizeAndEmit(runId, 'succeeded', null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.error({ err, runId }, 'automation advance crashed');
      await this.finalizeAndEmit(runId, 'failed', message);
    } finally {
      this.aborts.delete(runId);
    }
  }

  private async finalizeAndEmit(runId: string, status: 'succeeded' | 'failed', error: string | null): Promise<void> {
    this.deps.store.finalizeRun(runId, status, error);
    this.emitRun(runId);
    await this.deps.onRunFinalized?.(runId);
  }

  /**
   * A `running` checkpoint entry found before this advance() means a
   * previous interpreter died mid-action (Decision 12). Idempotent
   * run_action steps are left as-is — walk() falls through and re-executes
   * them. Everything else has "effect unknown": patch it to `failed`; if
   * that step doesn't opt into `keepGoing`, the caller fails the whole run
   * without walking further.
   */
  private resolveStaleRunningSteps(run: AutomationRunRecord): string | null {
    for (const [stepRef, entry] of Object.entries(run.checkpoint.steps)) {
      if (entry.status !== 'running') continue;
      const step = findStepById(run.checkpoint.definition.steps, entry.stepId);
      if (step && isRestartSafe(step, this.deps.isIdempotent)) continue;
      this.deps.store.patchCheckpoint(run.id, (checkpoint) => failStep(checkpoint, stepRef, RESTART_MID_ACTION_ERROR));
      if (!step?.keepGoing) return RESTART_MID_ACTION_ERROR;
    }
    return null;
  }

  /**
   * Fails one step directly, bypassing walk() — for callers outside the
   * normal advance loop that discover a step's side-channel state is lost
   * (Task 23's boot reconciler: a waiting ask_agent step whose agent_waits
   * row didn't survive a restart). Mirrors resolveStaleRunningSteps'/
   * failDeadlineStep's own pattern: walk() unconditionally skips a
   * re-entered 'failed' step regardless of keepGoing (walk.ts's re-entry
   * loop only consults keepGoing on a *fresh* failure), so a step without
   * keepGoing must finalize the run right here or a later advance() would
   * silently treat it as done.
   */
  async failStep(runId: string, stepRef: string, error: string): Promise<void> {
    const run = this.deps.store.getRun(runId);
    if (!run) return;
    const stepId = run.checkpoint.steps[stepRef]?.stepId;
    const step = stepId ? findStepById(run.checkpoint.definition.steps, stepId) : undefined;

    this.deps.store.patchCheckpoint(runId, (checkpoint) => failStep(checkpoint, stepRef, error));

    if (!step?.keepGoing) {
      await this.finalizeAndEmit(runId, 'failed', error);
      return;
    }
    await this.advance(runId);
  }

  private async failDeadlineStep(run: AutomationRunRecord): Promise<void> {
    const waiting = Object.entries(run.checkpoint.steps).find(([, entry]) => entry.status === 'waiting');
    if (!waiting) return;
    const [stepRef, entry] = waiting;
    if (entry.kind !== 'ask_agent') return;
    const step = findStepById(run.checkpoint.definition.steps, entry.stepId);

    this.deps.store.patchCheckpoint(run.id, (checkpoint) => {
      failStep(checkpoint, stepRef, AGENT_DEADLINE_ERROR);
      checkpoint.wakeAt = null;
      return checkpoint;
    });

    if (!step?.keepGoing) {
      await this.finalizeAndEmit(run.id, 'failed', AGENT_DEADLINE_ERROR);
      return;
    }
    await this.advance(run.id);
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

function isRestartSafe(step: AutomationStep, isIdempotent?: (step: AutomationStep) => boolean): boolean {
  return step.kind === 'run_action' && (isIdempotent?.(step) ?? false);
}

function failStep(checkpoint: AutomationCheckpoint, stepRef: string, error: string): AutomationCheckpoint {
  const target = checkpoint.steps[stepRef];
  if (target) {
    target.status = 'failed';
    target.error = error;
    target.finishedAt = Date.now();
  }
  return checkpoint;
}

/** The frozen definition snapshot always contains `id` (scope validation rejects duplicates); recurses into If/Repeat bodies since a stale `running` entry can be nested. */
function findStepById(steps: AutomationStep[], id: string): AutomationStep | undefined {
  for (const step of steps) {
    if (step.id === id) return step;
    if (step.kind === 'if') {
      const hit = findStepById(step.then, id) ?? findStepById(step.otherwise, id);
      if (hit) return hit;
    }
    if (step.kind === 'repeat') {
      const hit = findStepById(step.steps, id);
      if (hit) return hit;
    }
  }
  return undefined;
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
