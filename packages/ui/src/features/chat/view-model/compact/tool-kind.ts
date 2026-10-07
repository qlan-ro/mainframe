import type { ToolKind } from './types';

const kinds = new Map<string, ToolKind>([
  ['Read', 'read'],
  ['Edit', 'edit'],
  ['Write', 'write'],
  ['Glob', 'glob'],
  ['Grep', 'grep'],
  ['LS', 'list'],
  ['WebSearch', 'web-search'],
  ['WebFetch', 'fetch'],
  ['Bash', 'shell'],
  ['Task', 'subagent'],
]);
// The delegate card holds a task chat's transcript and gate, which have no other home on screen.
const fullCards = new Set([
  'ExitPlanMode',
  'AskUserQuestion',
  'Workflow',
  'RunWorkflow',
  'mcp__mainframe__delegate_task',
]);
export const mergeableKinds: ReadonlySet<ToolKind> = new Set([
  'read',
  'edit',
  'write',
  'glob',
  'grep',
  'list',
  'web-search',
  'fetch',
]);

export function toolKind(name: string): ToolKind {
  return kinds.get(name) ?? (name.startsWith('mcp__') ? 'mcp' : 'unknown');
}
export function isFullCard(name: string): boolean {
  return fullCards.has(name);
}
