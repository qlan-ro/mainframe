/* ── Adapter-declared tool categorization ──────────────────────── */

import type { ToolCategories } from '@mainframe/types';
export type { ToolCategories } from '@mainframe/types';

export function isExploreTool(name: string, categories: ToolCategories): boolean {
  return categories.explore.has(name);
}
export function isHiddenTool(name: string, categories: ToolCategories): boolean {
  return categories.hidden.has(name);
}
export function isTaskProgressTool(name: string, categories: ToolCategories): boolean {
  return categories.progress.has(name);
}
export function isSubagentTool(name: string, categories: ToolCategories): boolean {
  return categories.subagent.has(name);
}
