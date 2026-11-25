import { describe, expect, it } from 'vitest';
import { isChildWork, isMarkerTool, toolKind } from '../tool-kind';

describe('toolKind', () => {
  it('tells a delegated task from the other MCP calls', () => {
    expect(toolKind('mcp__mainframe__delegate_task')).toBe('delegate');
    expect(toolKind('mcp__mainframe__task_status')).toBe('mcp');
  });

  it('draws a Codex agent like a sub-agent and an unregistered tool like any other call', () => {
    expect(toolKind('CollabAgent')).toBe('subagent');
    expect(toolKind('docs__search')).toBe('unknown');
  });
});

it.each([
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
  'AskUserQuestion',
])('keeps %s on the spine', (name) => expect(isMarkerTool(name)).toBe(true));

it.each(['Bash', 'Task', 'Workflow', 'mcp__mainframe__delegate_task', 'mcp__github__get_issue', 'Artifact'])(
  'keeps %s in the work',
  (name) => expect(isMarkerTool(name)).toBe(false),
);

it('holds a turn open for agents, tasks and workflows alone', () => {
  expect(['Task', 'CollabAgent', 'mcp__mainframe__delegate_task', 'RunWorkflow'].every(isChildWork)).toBe(true);
  expect(['Monitor', 'Bash', 'ScheduleWakeup'].some(isChildWork)).toBe(false);
});
