// packages/core/src/automations/verbs/agent-waits.ts
//
// Task 19 (ports v1 workflows/agent-waits.ts onto `agent_waits(chat_id,
// run_id, step_ref)` in automations.db — contract §3: engine-internal,
// rebuildable, not a shared table). `AgentWaitService` is the ask_agent
// verb's waker: chat.updated wiring (Task 23) calls `onChatFinished`, which
// writes the step outcome into the checkpoint and advances.
//
// A failure without `keepGoing` finalizes the run directly instead of
// calling advance() — mirroring interpreter.ts's `failDeadlineStep` (Task
// 10): once a step is marked 'failed' outside the walk, walkSteps' re-entry
// just skips over it, so the keepGoing decision has to be made here, before
// advance() is called.
//
// Task 19b (A2): a completed chat whose step declares `expects` is routed
// through expects.ts's parseAndValidate. A mismatch sends ONE corrective
// message into the SAME chat (agent_waits.correction_sent guards the
// retry) and leaves the step waiting; a second mismatch fails it loudly.
import type { Logger } from 'pino';
import { findStepById, type AutomationStep, type DaemonEvent } from '@qlan-ro/mainframe-types';
import type { AutomationDb } from '../db.js';
import type { RunStore } from '../store/run-store.js';
import { TERMINAL_RUN_STATUSES, type AutomationCheckpoint, type AutomationRunRecord } from '../store/types.js';
import { toRunSummary } from '../engine/run-summary.js';
import { buildCorrectionMessage, parseAndValidate } from './expects.js';

interface WaitRow {
  run_id: string;
  step_ref: string;
  last_assistant_text: string | null;
  correction_sent: number;
}

interface WaitingStepContext {
  run: AutomationRunRecord;
  stepRef: string;
  step: AutomationStep | undefined;
}

export interface AgentWaitDeps {
  db: AutomationDb;
  store: RunStore;
  advanceRun: (runId: string) => Promise<void>;
  emitEvent: (event: DaemonEvent) => void;
  logger: Logger;
  /** Sends a corrective retry into an existing chat (A2 mismatch path). Only called when a step declares `expects`. */
  sendMessage: (chatId: string, content: string) => Promise<void>;
  onRunFinalized?: (runId: string) => void | Promise<void>;
}

export class AgentWaitService {
  constructor(private readonly deps: AgentWaitDeps) {}

  register(chatId: string, runId: string, stepRef: string): void {
    this.deps.db
      .prepare(
        `INSERT OR REPLACE INTO agent_waits (chat_id, run_id, step_ref, last_assistant_text) VALUES (?, ?, ?, NULL)`,
      )
      .run(chatId, runId, stepRef);
  }

  findByChat(chatId: string): { runId: string; stepRef: string } | null {
    const row = this.deps.db.prepare(`SELECT run_id, step_ref FROM agent_waits WHERE chat_id = ?`).get(chatId) as
      | Pick<WaitRow, 'run_id' | 'step_ref'>
      | undefined;
    return row ? { runId: row.run_id, stepRef: row.step_ref } : null;
  }

  findByRunStep(runId: string, stepRef: string): { chatId: string } | null {
    const row = this.deps.db
      .prepare(`SELECT chat_id FROM agent_waits WHERE run_id = ? AND step_ref = ?`)
      .get(runId, stepRef) as { chat_id: string } | undefined;
    return row ? { chatId: row.chat_id } : null;
  }

  /** Deletes every wait row for a run — called from cancelRun's one transaction so a chat that finishes after cancellation can't resurrect it via onChatFinished. */
  clearForRun(runId: string): number {
    return this.deps.db.prepare(`DELETE FROM agent_waits WHERE run_id = ?`).run(runId).changes;
  }

  /** Accumulate the latest assistant text while waiting (from message.added events). */
  recordAssistantText(chatId: string, text: string): void {
    this.deps.db.prepare(`UPDATE agent_waits SET last_assistant_text = ? WHERE chat_id = ?`).run(text, chatId);
  }

  /** Waker: chat.updated with a terminal reason. */
  async onChatFinished(chatId: string, reason: 'completed' | 'error' | 'interrupted'): Promise<void> {
    const row = this.getRow(chatId);
    if (!row) return;
    const context = this.loadWaitingStep(chatId, row);
    if (!context) return;

    if (reason === 'completed') {
      await this.handleCompleted(chatId, row, context);
      return;
    }

    this.clearWait(chatId);
    await this.failWaitingStep(context, `agent chat ${reason}`);
  }

  /** A2: routes through parseAndValidate when the step declares `expects`; a mismatch retries once before failing loudly. */
  private async handleCompleted(chatId: string, row: WaitRow, context: WaitingStepContext): Promise<void> {
    const expects = context.step?.kind === 'ask_agent' ? (context.step.expects ?? []) : [];
    const text = row.last_assistant_text ?? '';

    if (expects.length === 0) {
      this.clearWait(chatId);
      await this.succeedWaitingStep(context.run.id, context.stepRef, { result: text, chatId });
      return;
    }

    const parsed = parseAndValidate(text, expects);
    if (parsed.ok) {
      this.clearWait(chatId);
      await this.succeedWaitingStep(context.run.id, context.stepRef, { result: text, chatId, ...parsed.outputs });
      return;
    }

    if (row.correction_sent) {
      this.clearWait(chatId);
      await this.failWaitingStep(context, `agent did not return the expected JSON: ${parsed.reason}`);
      return;
    }

    this.deps.db.prepare(`UPDATE agent_waits SET correction_sent = 1 WHERE chat_id = ?`).run(chatId);
    await this.deps.sendMessage(chatId, buildCorrectionMessage(parsed.reason, expects));
  }

  private getRow(chatId: string): WaitRow | undefined {
    return this.deps.db
      .prepare(`SELECT run_id, step_ref, last_assistant_text, correction_sent FROM agent_waits WHERE chat_id = ?`)
      .get(chatId) as WaitRow | undefined;
  }

  private clearWait(chatId: string): void {
    this.deps.db.prepare(`DELETE FROM agent_waits WHERE chat_id = ?`).run(chatId);
  }

  private loadWaitingStep(chatId: string, row: WaitRow): WaitingStepContext | null {
    const run = this.deps.store.getRun(row.run_id);
    const entry = run?.checkpoint.steps[row.step_ref];
    if (!run || TERMINAL_RUN_STATUSES.has(run.status) || !entry || entry.status !== 'waiting') {
      this.clearWait(chatId);
      this.deps.logger.warn(
        { chatId, runId: row.run_id, stepRef: row.step_ref },
        'chat finished but the run is not waiting on this step',
      );
      return null;
    }
    const step = findStepById(run.checkpoint.definition.steps, entry.stepId) ?? undefined;
    return { run, stepRef: row.step_ref, step };
  }

  /** Re-checks terminality even though loadWaitingStep already gates entry — cancelRun races the checkpoint write, not just the wait-row lookup. */
  private async succeedWaitingStep(runId: string, stepRef: string, outputs: Record<string, unknown>): Promise<void> {
    const run = this.deps.store.getRun(runId);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return;
    this.deps.store.patchCheckpoint(runId, (checkpoint) => succeedStep(checkpoint, stepRef, outputs));
    await this.deps.advanceRun(runId);
  }

  private async failWaitingStep(context: WaitingStepContext, error: string): Promise<void> {
    const run = this.deps.store.getRun(context.run.id);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return;

    this.deps.store.patchCheckpoint(context.run.id, (checkpoint) => failStep(checkpoint, context.stepRef, error));

    if (!context.step?.keepGoing) {
      const finalRun = this.deps.store.finalizeRun(context.run.id, 'failed', error);
      this.deps.emitEvent({ type: 'automation.run.updated', run: toRunSummary(finalRun) });
      await this.deps.onRunFinalized?.(context.run.id);
      return;
    }
    await this.deps.advanceRun(context.run.id);
  }
}

function succeedStep(
  checkpoint: AutomationCheckpoint,
  stepRef: string,
  outputs: Record<string, unknown>,
): AutomationCheckpoint {
  const target = checkpoint.steps[stepRef];
  if (target) {
    target.status = 'succeeded';
    target.outputs = outputs;
    target.error = null;
    target.finishedAt = Date.now();
  }
  checkpoint.wakeAt = null;
  return checkpoint;
}

function failStep(checkpoint: AutomationCheckpoint, stepRef: string, error: string): AutomationCheckpoint {
  const target = checkpoint.steps[stepRef];
  if (target) {
    target.status = 'failed';
    target.error = error;
    target.finishedAt = Date.now();
  }
  checkpoint.wakeAt = null;
  return checkpoint;
}
