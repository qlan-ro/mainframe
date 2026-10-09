/**
 * The bound on a task chat's transcript inside its parent's `delegate_task`
 * card: the latest messages only, so a long-running child never turns the
 * parent's transcript into a second full chat. "Open full chat" has the rest.
 */

/** Twenty messages hold the last few turns — enough to follow the task and answer its gate. */
export const TASK_CHAT_WINDOW = 20;

export interface TaskChatWindow<T> {
  shown: readonly T[];
  /** Earlier messages left out of the card. */
  hiddenCount: number;
}

export function latestMessages<T>(messages: readonly T[], limit = TASK_CHAT_WINDOW): TaskChatWindow<T> {
  if (messages.length <= limit) return { shown: messages, hiddenCount: 0 };
  return { shown: messages.slice(-limit), hiddenCount: messages.length - limit };
}
