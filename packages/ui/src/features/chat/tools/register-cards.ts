/**
 * Populates the tool-card registry. Imported once for its side effect (by
 * ChatThread) — kept SEPARATE from registry.ts so the registry stays card-free
 * and the import graph has no cycle: registry ← tool-dispatch ← AssistantMessage
 * ← cards ← register-cards (a DAG; register-cards is a leaf).
 */
import { TOOL_REGISTRY } from './registry';
import { EditFileCard } from './cards/EditFileCard';
import { WriteFileCard } from './cards/WriteFileCard';
import { ReadFileCard } from './cards/ReadFileCard';
import { SearchCard } from './cards/SearchCard';
import { BashCard } from './cards/BashCard';
import { PlanCard } from './cards/PlanCard';
import { AskUserQuestionCard } from './cards/AskUserQuestionCard';
import { MCPToolCard } from './cards/MCPToolCard';
import {
  ScheduleWakeupCard,
  CronCreateCard,
  CronDeleteCard,
  CronListCard,
  MonitorCard,
} from './cards/SchedulePillCard';
import { EnterWorktreeCard, ExitWorktreeCard } from './cards/WorktreeStatusPillCard';
import { SlashCommandCard } from './cards/SlashCommandCard';
import { TaskCard } from './cards/TaskCard';
import { WebFetchCard } from './cards/WebFetchCard';
import { PushNotificationCard } from './cards/PushNotificationCard';
import { WorkflowLauncherRow } from '../workflow/WorkflowLauncherRow';

Object.assign(TOOL_REGISTRY, {
  // file-mutating
  Edit: EditFileCard,
  Write: WriteFileCard,
  // explore (groupable)
  Read: ReadFileCard,
  Glob: SearchCard,
  Grep: SearchCard,
  LS: SearchCard,
  // standalone
  Bash: BashCard,
  ExitPlanMode: PlanCard,
  AskUserQuestion: AskUserQuestionCard,
  WebFetch: WebFetchCard,
  WebSearch: WebFetchCard,
  PushNotification: PushNotificationCard,
  // marker pills
  _Mcp: MCPToolCard,
  ScheduleWakeup: ScheduleWakeupCard,
  CronCreate: CronCreateCard,
  CronDelete: CronDeleteCard,
  CronList: CronListCard,
  Monitor: MonitorCard,
  EnterWorktree: EnterWorktreeCard,
  ExitWorktree: ExitWorktreeCard,
  Skill: SlashCommandCard,
  // workflow launcher (the run panel opens from the row, never in place)
  Workflow: WorkflowLauncherRow,
  RunWorkflow: WorkflowLauncherRow,
  // subagent
  Task: TaskCard,
});
