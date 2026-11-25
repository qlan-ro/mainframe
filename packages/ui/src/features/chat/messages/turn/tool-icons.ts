import {
  Ban,
  Bot,
  CircleHelp,
  CircleStop,
  CircleX,
  Clock,
  Diff,
  FileText,
  FilePlus2,
  FolderTree,
  Globe,
  Layers,
  Plug,
  Search,
  ShieldAlert,
  Terminal,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { BotFilled } from '@/lib/icons/bot-filled';
import type { ToolKind } from '../../view-model/turn/tool-kind';
import type { ToolStatus } from '../../view-model/turn/types';

export type RowIcon = LucideIcon | typeof BotFilled;

/** A finished step shows what it was. */
export const KIND_ICONS: Record<ToolKind, RowIcon> = {
  read: FileText,
  edit: Diff,
  write: FilePlus2,
  glob: Search,
  grep: Search,
  list: FolderTree,
  'web-search': Globe,
  fetch: Globe,
  shell: Terminal,
  subagent: Bot,
  // Same robot as a sub-agent, filled (T1c).
  delegate: BotFilled,
  workflow: Workflow,
  artifact: Layers,
  mcp: Plug,
  unknown: Wrench,
};

/** How a step stands, when that outranks what it was. `queued` and `interrupted` are a delegated task's own. */
export type RowStatus = ToolStatus | 'queued' | 'interrupted' | 'needs-you';

export const STATUS_ICONS: Record<Exclude<RowStatus, 'success' | 'running'>, LucideIcon> = {
  failed: CircleX,
  stopped: CircleStop,
  interrupted: CircleStop,
  declined: Ban,
  queued: Clock,
  'awaiting-approval': ShieldAlert,
  'needs-you': ShieldAlert,
  unknown: CircleHelp,
};

export const STATUS_WORDS: Record<RowStatus, string> = {
  running: 'Running',
  success: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
  declined: 'Declined',
  queued: 'Queued',
  'awaiting-approval': 'Needs approval',
  'needs-you': 'Waiting on you',
  unknown: 'No result recorded',
};
