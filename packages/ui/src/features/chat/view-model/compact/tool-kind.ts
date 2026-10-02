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
const fullCards = new Set(['ExitPlanMode', 'AskUserQuestion', 'Workflow', 'RunWorkflow']);
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
