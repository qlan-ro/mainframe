import { makeAssistantToolUI } from '@assistant-ui/react';
import { EditFileCard } from './tools/EditFileCard';
import { WriteFileCard } from './tools/WriteFileCard';
import { BashCard } from './tools/BashCard';
import { ReadFileCard } from './tools/ReadFileCard';
import { SearchCard } from './tools/SearchCard';
import { ToolGroupCard } from './tools/ToolGroupCard';
import { TaskCard } from './tools/TaskCard';
import { TaskGroupCard } from './tools/TaskGroupCard';
import { TaskProgressCard } from './tools/TaskProgressCard';
import { PlanCard } from './tools/PlanCard';
import { SlashCommandCard } from './tools/SlashCommandCard';

export const EditToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'Edit',
  render: ({ args, result, isError }) => {
    if (args.old_string === undefined) return null;
    return <EditFileCard args={args} result={result} isError={isError} />;
  },
});

export const WriteToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'Write',
  render: ({ args, result, isError }) => <WriteFileCard args={args} result={result} isError={isError} />,
});

export const BashToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'Bash',
  render: ({ args, result, isError }) => <BashCard args={args} result={result} isError={isError} />,
});

export const ReadToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'Read',
  render: ({ args, result, isError }) => <ReadFileCard args={args} result={result} isError={isError} />,
});

export const GlobToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'Glob',
  render: ({ args, result, isError }) => <SearchCard toolName="Glob" args={args} result={result} isError={isError} />,
});

export const GrepToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'Grep',
  render: ({ args, result, isError }) => <SearchCard toolName="Grep" args={args} result={result} isError={isError} />,
});

export const TaskToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'Task',
  render: ({ args, result, isError }) => <TaskCard args={args} result={result} isError={isError} />,
});

export const ExitPlanModeToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'ExitPlanMode',
  render: ({ args, result, isError }) => <PlanCard args={args} result={result} isError={isError} />,
});

export const SkillToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'Skill',
  render: ({ args }) => <SlashCommandCard args={args} />,
});

// Virtual tool types from convert-message grouping
export const ToolGroupUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: '_ToolGroup',
  render: ({ args }) => <ToolGroupCard args={args} />,
});

export const TaskGroupUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: '_TaskGroup',
  render: ({ args, result, isError }) => <TaskGroupCard args={args} result={result} isError={isError} />,
});

export const TaskProgressUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: '_TaskProgress',
  render: ({ args }) => <TaskProgressCard args={args} />,
});

// Tools that should be hidden (rendered as null)
const HIDDEN_TOOLS = [
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskStop',
  'TodoWrite',
  'EnterPlanMode',
  'AskUserQuestion',
] as const;
export const HiddenToolUIs = HIDDEN_TOOLS.map((toolName) =>
  makeAssistantToolUI<Record<string, unknown>, unknown>({
    toolName,
    render: () => null,
  }),
);

export const AllToolUIs = [
  EditToolUI,
  WriteToolUI,
  BashToolUI,
  ReadToolUI,
  GlobToolUI,
  GrepToolUI,
  TaskToolUI,
  ExitPlanModeToolUI,
  SkillToolUI,
  ToolGroupUI,
  TaskGroupUI,
  TaskProgressUI,
  ...HiddenToolUIs,
];
