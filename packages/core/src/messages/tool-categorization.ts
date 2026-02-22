/* ── Adapter-declared tool categorization ──────────────────────── */

export interface ToolCategories {
  explore: Set<string>;
  hidden: Set<string>;
  progress: Set<string>;
  subagent: Set<string>;
}

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
