/**
 * Reads one workflow run out of chat state. `taskId` is the canonical key (A1):
 * the CLI emits a task id on every progress event, while the run id only arrives
 * with the launch result and some snapshots.
 */
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { useOwnChatState } from '../runtime/own-chat-state';

export function useWorkflowRun(taskId: string | undefined): ClaudeWorkflowRun | undefined {
  return useOwnChatState((state) => (taskId ? state.workflowRuns[taskId] : undefined));
}
