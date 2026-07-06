import type { Logger } from 'pino';
import type { WorkflowDb } from './db.js';
import type { RunStore } from './store/run-store.js';
import type { WorkflowEngine } from './engine/engine.js';

export class AgentWaitService {
  private engine: WorkflowEngine | null = null;

  constructor(
    private readonly db: WorkflowDb,
    private readonly store: RunStore,
    private readonly logger: Logger,
  ) {}

  bindEngine(engine: WorkflowEngine): void {
    this.engine = engine;
  }

  register(chatId: string, runId: string, stepPath: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_waits (chat_id, run_id, step_path, last_assistant_text) VALUES (?, ?, ?, NULL)`,
      )
      .run(chatId, runId, stepPath);
  }

  findByChat(chatId: string): { runId: string; stepPath: string } | null {
    const row = this.db.prepare(`SELECT run_id, step_path FROM agent_waits WHERE chat_id = ?`).get(chatId) as
      | { run_id: string; step_path: string }
      | undefined;
    return row ? { runId: row.run_id, stepPath: row.step_path } : null;
  }

  /** Accumulate the latest assistant text while waiting (from message.added events). */
  recordAssistantText(chatId: string, text: string): void {
    this.db.prepare(`UPDATE agent_waits SET last_assistant_text = ? WHERE chat_id = ?`).run(text, chatId);
  }

  /** Waker: chat.updated with a terminal reason. */
  async onChatFinished(chatId: string, reason: 'completed' | 'error' | 'interrupted'): Promise<void> {
    const wait = this.findByChat(chatId);
    if (!wait || !this.engine) return;

    const textRow = this.db.prepare(`SELECT last_assistant_text FROM agent_waits WHERE chat_id = ?`).get(chatId) as
      | { last_assistant_text: string | null }
      | undefined;

    this.db.prepare(`DELETE FROM agent_waits WHERE chat_id = ?`).run(chatId);

    const latest = this.store.latestStepResults(wait.runId).get(wait.stepPath);
    if (!latest || latest.status !== 'waiting') {
      this.logger.warn({ chatId, runId: wait.runId, stepPath: wait.stepPath }, 'chat finished but step is not waiting');
      return;
    }

    if (reason === 'completed') {
      this.store.commitStep(wait.runId, {
        stepPath: wait.stepPath,
        stepId: latest.stepId,
        kind: 'agent',
        attempt: latest.attempt,
        status: 'succeeded',
        input: null,
        output: { text: textRow?.last_assistant_text ?? '', chatId },
        scratch: latest.scratch,
        error: null,
      });
    } else {
      this.store.commitStep(wait.runId, {
        stepPath: wait.stepPath,
        stepId: latest.stepId,
        kind: 'agent',
        attempt: latest.attempt,
        status: 'failed',
        input: null,
        output: null,
        scratch: latest.scratch,
        error: `agent chat ${reason}`,
      });
    }

    await this.engine.advance(wait.runId);
  }
}
