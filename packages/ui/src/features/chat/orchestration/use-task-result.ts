import { useMemo } from 'react';
import { useLiveMessages } from '../runtime/use-live-messages';
import type { TaskResultMarker } from '../markers/agent-message';
import { taskResult } from '../view-model/turn/task-results';

/** The result the daemon delivered for a task, once it is in the loaded history. */
export function useTaskResult(taskId: string | undefined): TaskResultMarker | undefined {
  // Each message's results are parsed once and kept, so the selected object is stable.
  const messages = useLiveMessages();
  return useMemo(() => (taskId ? taskResult(messages, taskId) : undefined), [messages, taskId]);
}
