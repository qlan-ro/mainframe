/**
 * Shared helpers for reading V2 task-tool (TaskCreate/TaskUpdate) results.
 * Used by the daemon's cross-message subject backfill AND the UI's
 * TaskProgressCard reducer — keep the two sides' id semantics identical.
 */

/** Matches the CLI's TaskCreate result text: "Task #<id> created successfully: …". */
export const TASK_ID_RE = /Task #(\d+)/;

/** Plain text of a task tool result — bare string or ToolCallResult-shaped `{ content }`. */
export function taskResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const content = (result as { content?: unknown }).content;
    if (typeof content === 'string') return content;
  }
  return '';
}

/** The task id extracted from a TaskCreate result, or undefined when absent. */
export function extractTaskId(result: unknown): string | undefined {
  return TASK_ID_RE.exec(taskResultText(result))?.[1];
}
