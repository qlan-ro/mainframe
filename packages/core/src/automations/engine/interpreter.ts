// packages/core/src/automations/engine/interpreter.ts
//
// Serialized per-run advance loop (port of v1 workflows/engine/engine.ts:48-96,
// contract §2 Decision 12). One AutomationInterpreter instance owns the
// in-flight map across all runs; advance() is safe to call repeatedly (wake,
// boot reconcile, retry) — concurrent calls for the same runId share one
// promise so a step never executes twice from a race.
import type { Logger } from 'pino';
import {
  findStepById,
  type AutomationDefinition,
  type AutomationStep,
  type DaemonEvent,
} from '@qlan-ro/mainframe-types';
import type { InteractionStore } from '../store/interaction-store.js';
import type { RunStore } from '../store/run-store.js';
import {
  AutomationRunTerminalError,
  TERMINAL_RUN_STATUSES,
  type AutomationCheckpoint,
  type AutomationRunRecord,
  type AutomationRunTriggerContext,
} from '../store/types.js';
import { toRunSummary } from './run-summary.js';
import { walkSteps } from './walk.js';
import type { VerbPorts, WalkResult } from './types.js';

export { toRunSummary } from './run-summary.js';

/** Narrow view of AgentWaitService — cancelRun only needs to purge stale wait rows, not the full waker surface (avoids an engine -> verbs import cycle). */
export interface AgentWaitCleaner {
  clearForRun(runId: string): number;
}

export interface InterpreterDeps {
  store: RunStore;
  interactions: InteractionStore;
  ports: VerbPorts;
  emitEvent: (event: DaemonEvent) => void;
  logger: Logger;
  onRunFinalized?: (runId: string) => void | Promise<void>;
  /** Decision 12 restart policy: true only for run_action steps safe to blindly re-invoke after an unknown-effect restart. Defaults to false (fail loudly); ask_agent is never restart-safe regardless of this hook. */
  isIdempotent?: (step: AutomationStep) => boolean;
  /** Optional so existing tests that never exercise ask_agent cancellation don't need a fake — cancelRun no-ops the cleanup when absent. */
  agentWaits?: AgentWaitCleaner;
}

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

  /**
   * Cancellation is authoritative (contract §3): finalize, cancel pending
   * interactions, and purge agent_waits rows in ONE transaction (parity
   * with InteractionStore.resolveInOneTx) so no partial state survives a
   * crash mid-cancel, and no chat that finishes afterward can resurrect the
   * run via AgentWaitService.onChatFinished. A run that's already terminal
   * (double-cancel, or lost the race to its own finalize) is a silent
   * no-op, not an error.
   */
  async cancelRun(runId: string): Promise<void> {
    this.aborts.get(runId)?.abort();
    try {
      this.deps.store.withTransaction(() => {
        this.deps.store.finalizeRun(runId, 'cancelled', null);
        this.deps.interactions.cancelPendingForRun(runId);
        this.deps.agentWaits?.clearForRun(runId);
      });
    } catch (err) {
      if (err instanceof AutomationRunTerminalError) return;
      throw err;
    }
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
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return;

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
      // cancelRun can finalize this same run while the walk above was mid-flight
      // (it isn't serialized through advance()'s inFlight map) — re-check before
      // trusting the walk's own verdict so a late 'done'/'failed' never clobbers
      // an already-cancelled run.
      if (this.isNowTerminal(runId)) return;
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
      if (err instanceof AutomationRunTerminalError) return;
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.error({ err, runId }, 'automation advance crashed');
      if (this.isNowTerminal(runId)) return;
      await this.finalizeAndEmit(runId, 'failed', message);
    } finally {
      this.aborts.delete(runId);
    }
  }

  private isNowTerminal(runId: string): boolean {
    const current = this.deps.store.getRun(runId);
    return !current || TERMINAL_RUN_STATUSES.has(current.status);
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
      onStepSettled: () => this.emitRun(run.id),
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
