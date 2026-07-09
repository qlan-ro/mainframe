import type { BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind } from '@qlan-ro/mainframe-types';
import { BackgroundTaskTracker } from '../../../background-tasks/tracker.js';
import { encodeCwdSegment } from '../../../background-tasks/encoding.js';
import { spoolRoot } from '../../../background-tasks/spool-root.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude:task-events');

const METADATA_TTL_MS = 60_000;

type Metadata = { toolName: BackgroundTaskToolName; command: string };

type ToolUsePayload = {
  name: string;
  input?: { command?: string; description?: string; run_in_background?: boolean };
};

type TaskStartedPayload = {
  task_id: string;
  tool_use_id?: string;
  description?: string;
  task_type?: string;
};

type TaskUpdatedPayload = {
  task_id: string;
  status: string;
};

type TaskNotificationPayload = {
  task_id: string;
  status: string;
  output_file?: string;
  summary?: string;
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number };
};

const KNOWN_STATUSES = new Set<BackgroundTaskStatus>(['completed', 'failed', 'stopped']);

/**
 * CLI `task_type` → client-facing kind. Prefix-tolerant (`local_agent`,
 * `remote_agent`, teammates → agent) so new CLI variants degrade gracefully;
 * genuinely unknown types land in 'other', never dropped.
 */
export function mapTaskKind(taskType: string | undefined, hasBashMetadata: boolean): BackgroundWorkKind {
  if (taskType === undefined) return hasBashMetadata ? 'bash' : 'other';
  if (taskType.includes('bash')) return 'bash';
  if (taskType.includes('agent') || taskType.includes('teammate')) return 'agent';
  if (taskType.includes('workflow')) return 'workflow';
  return 'other';
}

function mapStatus(s: string): Exclude<BackgroundTaskStatus, 'running'> {
  if (KNOWN_STATUSES.has(s as BackgroundTaskStatus)) {
    return s as Exclude<BackgroundTaskStatus, 'running'>;
  }
  log.warn({ status: s }, 'unknown task_notification status, defaulting to stopped');
  return 'stopped';
}

export class ClaudeTaskEvents {
  private readonly metadata = new Map<string, Metadata>();
  private readonly evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly tracker: BackgroundTaskTracker) {}

  /** Called from events.ts for every tool_use event. */
  captureToolUse(toolUseId: string, payload: ToolUsePayload): void {
    const isBashBg = payload.name === 'Bash' && payload.input?.run_in_background === true;
    const isMonitor = payload.name === 'Monitor';
    if (!isBashBg && !isMonitor) return;
    const toolName: BackgroundTaskToolName = isMonitor ? 'Monitor' : 'Bash';
    const command = payload.input?.command ?? payload.input?.description ?? '<unknown>';
    this.metadata.set(toolUseId, { toolName, command });
    const timer = setTimeout(() => {
      this.metadata.delete(toolUseId);
      this.evictionTimers.delete(toolUseId);
    }, METADATA_TTL_MS);
    timer.unref?.();
    this.evictionTimers.set(toolUseId, timer);
  }

  handleTaskStarted(
    chatId: string,
    payload: TaskStartedPayload,
    ctx: { claudeSessionId: string; realCwd: string },
  ): void {
    const meta = payload.tool_use_id ? this.consume(payload.tool_use_id) : null;
    const outputPath = `${spoolRoot()}/${encodeCwdSegment(ctx.realCwd)}/${ctx.claudeSessionId}/tasks/${payload.task_id}.output`;
    this.tracker.start(
      chatId,
      {
        id: payload.task_id,
        kind: mapTaskKind(payload.task_type, meta !== null),
        toolName: meta?.toolName ?? 'Bash',
        toolUseId: payload.tool_use_id ?? '',
        command: meta?.command ?? payload.description ?? '<unknown>',
        description: payload.description ?? '',
      },
      outputPath,
    );
  }

  /**
   * `task_updated` fires alongside `task_notification` (post-leak CLI addition).
   * Only a terminal status closes the task — the tracker dedups when the
   * notification already landed; non-terminal updates carry nothing we track.
   */
  handleTaskUpdated(chatId: string, payload: TaskUpdatedPayload): void {
    if (!KNOWN_STATUSES.has(payload.status as BackgroundTaskStatus)) return;
    this.tracker.end(chatId, payload.task_id, {
      status: payload.status as Exclude<BackgroundTaskStatus, 'running'>,
      outputPath: '',
      summary: '',
      usage: null,
    });
  }

  handleTaskNotification(chatId: string, payload: TaskNotificationPayload): void {
    this.tracker.end(chatId, payload.task_id, {
      status: mapStatus(payload.status),
      outputPath: payload.output_file ?? '',
      summary: payload.summary ?? '',
      usage: payload.usage
        ? {
            totalTokens: payload.usage.total_tokens,
            toolUses: payload.usage.tool_uses,
            durationMs: payload.usage.duration_ms,
          }
        : null,
    });
  }

  private consume(toolUseId: string): Metadata | null {
    const m = this.metadata.get(toolUseId);
    if (!m) return null;
    this.metadata.delete(toolUseId);
    const timer = this.evictionTimers.get(toolUseId);
    if (timer) {
      clearTimeout(timer);
      this.evictionTimers.delete(toolUseId);
    }
    return m;
  }
}
