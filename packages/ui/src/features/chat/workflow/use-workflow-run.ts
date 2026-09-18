/**
 * Reads one workflow run out of chat state. `taskId` is the canonical key (A1):
 * the CLI emits a task id on every progress event, while the run id only arrives
 * with the launch result and some snapshots.
 */
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { useChatExtras } from '../runtime/chat-extras';

export function useWorkflowRun(taskId: string | undefined): ClaudeWorkflowRun | undefined {
  const extras = useChatExtras();
  return taskId ? extras?.state.workflowRuns[taskId] : undefined;
}
