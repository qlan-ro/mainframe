// packages/core/src/automations/reconciler.ts
//
// Task 23. Boot reconciliation, ported from v1 workflows/reconciler.ts:
//
// - 'running': the daemon died mid-advance. Re-advance; the interpreter's
//   own stale-marker self-heal (Decision 12) takes it from there — an
//   idempotent run_action re-runs, everything else fails loudly (finalizing
//   the run itself when it has no keepGoing).
//
// - 'waiting' ask_agent steps whose agent_waits row is missing: the daemon
//   died between chat creation and wait registration (the narrow window in
//   verbs/ask-agent.ts). v2 has no 'ambiguous' status — fail the step
//   directly via AutomationInterpreter.failStep, which applies the same
//   keepGoing decision the rest of the engine uses.
//
// - Other 'waiting' runs (ask_me, or an ask_agent step whose wait row is
//   present): self-sufficient — sweep() and interaction/chat responses
//   drive them. A plain advance() is still safe to issue: a genuinely
//   parked step returns 'parked' immediately without re-invoking its port.
//
// RunStore.patchCheckpoint derives run.status from checkpoint.wakeAt alone
// ('waiting' only when non-null; a park with no deadline — the ask_me/
// ask_agent-without-timeoutMinutes default — reads back as 'running' even
// though the step itself is 'waiting'). So this reconciler does not branch
// on run.status the way v1 did: it always checks for an orphaned agent
// step first, and only re-advances directly when that check found nothing
// to fix.
import type { Logger } from 'pino';
import type { AutomationDb } from './db.js';
import type { RunStore } from './store/run-store.js';
import type { AutomationInterpreter } from './engine/interpreter.js';

export async function reconcileAutomationsOnBoot(
  db: AutomationDb,
  store: RunStore,
  interpreter: AutomationInterpreter,
  logger: Logger,
): Promise<void> {
  const resumable = store.loadResumable();
  logger.info({ count: resumable.length }, 'automation reconciler: resumable runs found');

  for (const run of resumable) {
    const fixedOrphan = await failOrphanedAgentWait(db, store, interpreter, logger, run.id);
    if (fixedOrphan) continue; // failStep() already re-advanced or finalized the run

    try {
      await interpreter.advance(run.id);
    } catch (err) {
      logger.error({ err, runId: run.id }, 'automation reconciler: re-advance failed');
    }
  }
}

/** Returns true when an orphaned ask_agent wait was found and handled — the caller should not also call advance() itself, since failStep() already does. */
async function failOrphanedAgentWait(
  db: AutomationDb,
  store: RunStore,
  interpreter: AutomationInterpreter,
  logger: Logger,
  runId: string,
): Promise<boolean> {
  const run = store.getRun(runId);
  if (!run) return false;

  for (const [stepRef, entry] of Object.entries(run.checkpoint.steps)) {
    if (entry.status !== 'waiting' || entry.kind !== 'ask_agent') continue;

    const hasWaitRow = db.prepare(`SELECT 1 FROM agent_waits WHERE run_id = ? AND step_ref = ?`).get(runId, stepRef);
    if (hasWaitRow) continue;

    logger.warn({ runId, stepRef }, 'automation reconciler: agent wait row missing — failing step');
    try {
      await interpreter.failStep(runId, stepRef, 'daemon restarted between chat creation and wait registration');
    } catch (err) {
      logger.error({ err, runId, stepRef }, 'automation reconciler: failStep failed');
    }
    return true;
  }
  return false;
}
