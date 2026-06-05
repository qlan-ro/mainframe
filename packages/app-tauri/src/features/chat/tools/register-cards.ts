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
import { SkillLoadedCard } from './cards/SkillLoadedCard';
import { TaskCard } from './cards/TaskCard';
import { TaskProgressCard } from './cards/TaskProgressCard';

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
  _SkillLoaded: SkillLoadedCard,
  // subagent + progress
  Task: TaskCard,
  _TaskProgress: TaskProgressCard,
});
