import type { Logger } from 'pino';
import type { WorkflowDb } from './db.js';
import type { RunStore } from './store/run-store.js';
import type { WorkflowEngine } from './engine/engine.js';

/**
 * Boot reconciliation — mirrors the background-task reconcile pattern.
 *
 * After a daemon restart, every non-terminal run needs recovery:
 *
 * - 'running': the daemon died mid-advance. Re-advance; the interpreter's replay
 *   skips already-committed steps. Stale 'running' step rows from non-idempotent
 *   connectors become 'ambiguous' via the engine's own stale-step detection.
 *
 * - 'waiting' agent steps whose agent_waits row is missing: the daemon died between
 *   chat creation and wait registration (the narrow window in agent.ts). Mark
 *   ambiguous and re-advance so on_failure policy applies.
 *
 * - Other 'waiting' runs (human/timer): rows are self-sufficient; sweep() and
 *   interaction responses drive them. Nothing to do here.
 */
export async function reconcileOnBoot(
  db: WorkflowDb,
  store: RunStore,
  engine: WorkflowEngine,
  logger: Logger,
): Promise<void> {
  const resumable = store.loadResumable();
  logger.info({ count: resumable.length }, 'workflow reconciler: resumable runs found');

  for (const run of resumable) {
    if (run.status === 'running') {
      try {
        await engine.advance(run.id);
      } catch (err) {
        logger.error({ err, runId: run.id }, 'workflow reconciler: re-advance failed');
      }
      continue;
    }

    // 'waiting' — check agent steps for orphaned waits.
    await reconcileWaitingRun(db, store, engine, logger, run.id);
  }
}

async function reconcileWaitingRun(
  db: WorkflowDb,
  store: RunStore,
  engine: WorkflowEngine,
  logger: Logger,
  runId: string,
): Promise<void> {
  let advanceNeeded = false;

  for (const [stepPath, step] of store.latestStepResults(runId)) {
    if (step.status !== 'waiting' || step.kind !== 'agent') continue;

    const chatId = (step.scratch as { chatId?: string } | null)?.chatId;
    const hasMappingRow = chatId ? db.prepare(`SELECT 1 FROM agent_waits WHERE chat_id = ?`).get(chatId) : undefined;

    if (!chatId || !hasMappingRow) {
      logger.warn({ runId, stepPath, chatId }, 'workflow reconciler: agent wait row missing — marking ambiguous');
      store.commitStep(runId, {
        stepPath,
        stepId: step.stepId,
        kind: 'agent',
        attempt: step.attempt,
        status: 'ambiguous',
        input: null,
        output: null,
        scratch: step.scratch,
        error: 'daemon restarted between chat creation and wait registration',
      });
      advanceNeeded = true;
    }
  }

  if (advanceNeeded) {
    try {
      await engine.advance(runId);
    } catch (err) {
      logger.error({ err, runId }, 'workflow reconciler: advance after ambiguous mark failed');
    }
  }
}
