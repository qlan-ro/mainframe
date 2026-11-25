/** Which row, marker or card a tool call is drawn as (T1a, T1g). */
export type ToolKind =
  | 'read'
  | 'edit'
  | 'write'
  | 'glob'
  | 'grep'
  | 'list'
  | 'web-search'
  | 'fetch'
  | 'shell'
  | 'subagent'
  | 'delegate'
  | 'workflow'
  | 'artifact'
  | 'mcp'
  | 'unknown';

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
  ['CollabAgent', 'subagent'],
  ['mcp__mainframe__delegate_task', 'delegate'],
  ['Workflow', 'workflow'],
  ['RunWorkflow', 'workflow'],
  ['Artifact', 'artifact'],
]);

/** Event tools: pills on the spine, outside the folded work. */
const markers: ReadonlySet<string> = new Set([
  'Skill',
  'ExitPlanMode',
  'ScheduleWakeup',
  'CronCreate',
  'CronDelete',
  'CronList',
  'Monitor',
  'EnterWorktree',
  'ExitWorktree',
  'PushNotification',
]);

export const EXPLORE_KINDS: ReadonlySet<ToolKind> = new Set(['read', 'glob', 'grep', 'list']);

export function toolKind(name: string): ToolKind {
  return kinds.get(name) ?? (name.startsWith('mcp__') ? 'mcp' : 'unknown');
}
export function isMarkerTool(name: string): boolean {
  return markers.has(name) || isQuestionTool(name);
}
/** An answered question stays outside the work as a small card (T1g). */
export function isQuestionTool(name: string): boolean {
  return name === 'AskUserQuestion';
}
/** Work that can outlive the call that started it, and holds its turn open (T1e). */
export function isChildWork(name: string): boolean {
  return ['subagent', 'delegate', 'workflow'].includes(toolKind(name));
}
