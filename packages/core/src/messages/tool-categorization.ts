/* ── Tool categorization constants ─────────────────────────────── */

export const EXPLORE_TOOLS = new Set(['Read', 'Glob', 'Grep']);
export const HIDDEN_TOOLS = new Set([
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskStop',
  'TodoWrite',
  'Skill',
  'EnterPlanMode',
  'AskUserQuestion',
]);
export const TASK_PROGRESS_TOOLS = new Set(['TaskCreate', 'TaskUpdate']);

export function isExploreTool(name: string): boolean {
  return EXPLORE_TOOLS.has(name);
}
export function isHiddenTool(name: string): boolean {
  return HIDDEN_TOOLS.has(name);
}
export function isTaskProgressTool(name: string): boolean {
  return TASK_PROGRESS_TOOLS.has(name);
}
