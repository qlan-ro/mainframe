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
import { AskUserQuestionToolCard } from './tools/AskUserQuestionToolCard';
import { WorktreeStatusPill } from './tools/WorktreeStatusPill';
import { SchedulePill } from './tools/SchedulePill';

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

export const AgentToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'Agent',
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

export const AskUserQuestionToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'AskUserQuestion',
  render: ({ args, result }) => <AskUserQuestionToolCard args={args} result={result} />,
});

export const EnterWorktreeToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'EnterWorktree',
  render: ({ args, result, isError }) => (
    <WorktreeStatusPill toolName="EnterWorktree" args={args} result={result as never} isError={isError} />
  ),
});
export const ExitWorktreeToolUI = makeAssistantToolUI<Record<string, unknown>, unknown>({
  toolName: 'ExitWorktree',
  render: ({ args, result, isError }) => (
    <WorktreeStatusPill toolName="ExitWorktree" args={args} result={result as never} isError={isError} />
  ),
});

const SCHEDULE_TOOLS = ['ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList', 'Monitor'] as const;
export const ScheduleToolUIs = SCHEDULE_TOOLS.map((toolName) =>
  makeAssistantToolUI<Record<string, unknown>, unknown>({
    toolName,
    render: ({ args, result, isError }) => (
      <SchedulePill toolName={toolName} args={args} result={result as never} isError={isError} />
    ),
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
  AgentToolUI,
  ExitPlanModeToolUI,
  SkillToolUI,
  AskUserQuestionToolUI,
  EnterWorktreeToolUI,
  ExitWorktreeToolUI,
  ToolGroupUI,
  TaskGroupUI,
  TaskProgressUI,
  ...ScheduleToolUIs,
];
