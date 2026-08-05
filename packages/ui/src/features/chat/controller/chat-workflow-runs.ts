/**
 * Pure workflow-run slice for the chat-thread reducer.
 *
 * Claude CLI workflow runs arrive as whole `ClaudeWorkflowRun` objects — live on
 * `claude_workflow.run.updated`, and as a list on the history payload after a
 * reload. Both paths replace a run wholesale; the daemon owns the merge.
 */
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';

/** Runs of one chat, keyed by the CLI's `task_id` — the run id is learned later. */
export type WorkflowRunsSlice = Readonly<Record<string, ClaudeWorkflowRun>>;

const EMPTY: WorkflowRunsSlice = {};

/**
 * Structural equality over wire JSON rather than a field list: a run gains
 * fields as the CLI's snapshot grows, and a field list that forgets one reports
 * a changed run as unchanged.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Replaces the run at `run.taskId`; returns the same slice when it did not move. */
export function upsertWorkflowRun(slice: WorkflowRunsSlice, run: ClaudeWorkflowRun): WorkflowRunsSlice {
  const current = slice[run.taskId];
  if (current !== undefined && sameJson(current, run)) return slice;
  return { ...slice, [run.taskId]: run };
}

/** Builds the slice from a history payload — a replace, never a merge. */
export function seedWorkflowRuns(runs: readonly ClaudeWorkflowRun[]): WorkflowRunsSlice {
  if (runs.length === 0) return EMPTY;
  const next: Record<string, ClaudeWorkflowRun> = {};
  for (const run of runs) next[run.taskId] = run;
  return next;
}
