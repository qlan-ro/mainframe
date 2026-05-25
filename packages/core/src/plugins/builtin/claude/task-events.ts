import type { BackgroundTaskStatus, BackgroundTaskToolName } from '@qlan-ro/mainframe-types';
import { BackgroundTaskTracker } from '../../../background-tasks/tracker.js';
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
};

type TaskNotificationPayload = {
  task_id: string;
  status: string;
  output_file?: string;
  summary?: string;
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number };
};

const KNOWN_STATUSES = new Set<BackgroundTaskStatus>(['completed', 'failed', 'stopped']);

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

  handleTaskStarted(chatId: string, payload: TaskStartedPayload): void {
    const meta = payload.tool_use_id ? this.consume(payload.tool_use_id) : null;
    this.tracker.start(chatId, {
      id: payload.task_id,
      toolName: meta?.toolName ?? 'Bash',
      toolUseId: payload.tool_use_id ?? '',
      command: meta?.command ?? payload.description ?? '<unknown>',
      description: payload.description ?? '',
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
