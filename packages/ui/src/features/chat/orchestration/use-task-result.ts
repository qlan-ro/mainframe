import { useAuiState } from '@assistant-ui/react';
import type { TaskResultMarker } from '../markers/agent-message';
import { taskResult } from '../view-model/turn/task-results';

/** The result the daemon delivered for a task, once it is in the loaded history. */
export function useTaskResult(taskId: string | undefined): TaskResultMarker | undefined {
  // Each message's results are parsed once and kept, so the selected object is stable.
  return useAuiState((s) => (taskId ? taskResult(s.thread.messages, taskId) : undefined));
}
