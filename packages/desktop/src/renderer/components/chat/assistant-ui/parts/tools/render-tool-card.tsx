import React from 'react';
import { EditFileCard } from './EditFileCard';
import { WriteFileCard } from './WriteFileCard';
import { BashCard } from './BashCard';
import { ReadFileCard } from './ReadFileCard';
import { SearchCard } from './SearchCard';
import { DefaultToolCard } from './DefaultToolCard';
import { ToolGroupCard } from './ToolGroupCard';
import { TaskCard } from './TaskCard';
import { TaskGroupCard } from './TaskGroupCard';
import { TaskProgressCard } from './TaskProgressCard';
import { PlanCard } from './PlanCard';
import { SlashCommandCard } from './SlashCommandCard';

const HIDDEN_TOOL_NAMES = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskStop',
  'TodoWrite',
  'EnterPlanMode',
  'AskUserQuestion',
]);

export function renderToolCard(
  toolName: string,
  args: Record<string, unknown>,
  argsText: string,
  result: unknown,
  isError: boolean | undefined,
): React.ReactElement | null {
  if (HIDDEN_TOOL_NAMES.has(toolName)) return null;
  if (toolName === 'Skill') return <SlashCommandCard args={args} />;
  if (toolName === '_ToolGroup') return <ToolGroupCard args={args} />;
  if (toolName === '_TaskProgress') return <TaskProgressCard args={args} />;
  if (toolName === '_TaskGroup') return <TaskGroupCard args={args} result={result} isError={isError} />;
  if (toolName === 'Task') return <TaskCard args={args} result={result} isError={isError} />;
  if (toolName === 'ExitPlanMode') return <PlanCard args={args} result={result} isError={isError} />;
  if (toolName === 'Edit' && args.old_string !== undefined)
    return <EditFileCard args={args} result={result} isError={isError} />;
  if (toolName === 'Write') return <WriteFileCard args={args} result={result} isError={isError} />;
  if (toolName === 'Bash') return <BashCard args={args} result={result} isError={isError} />;
  if (toolName === 'Read') return <ReadFileCard args={args} result={result} isError={isError} />;
  if (toolName === 'Glob' || toolName === 'Grep')
    return <SearchCard toolName={toolName} args={args} result={result} isError={isError} />;
  return <DefaultToolCard toolName={toolName} args={args} argsText={argsText} result={result} isError={isError} />;
}
