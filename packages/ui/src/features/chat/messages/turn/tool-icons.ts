import {
  Ban,
  Bot,
  CircleHelp,
  CircleStop,
  CircleX,
  Clock,
  Diff,
  FileText,
  Globe,
  Layers,
  Plug,
  Search,
  ShieldAlert,
  Terminal,
  Workflow,
  Wrench,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react';
import { BotFilled } from '@/lib/icons/bot-filled';
import type { ToolKind } from '../../view-model/turn/tool-kind';
import type { ToolStatus } from '../../view-model/turn/types';

const WriteIcon = createLucideIcon('write', [
  ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', key: 'page' }],
  ['path', { d: 'M14 2v6h6M12 18v-6M9 15h6', key: 'fold-plus' }],
]);

const ListTreeIcon = createLucideIcon('tree', [
  [
    'path',
    {
      d: 'M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z',
      key: '0',
    },
  ],
  [
    'path',
    {
      d: 'M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z',
      key: '1',
    },
  ],
  ['path', { d: 'M3 5a2 2 0 0 0 2 2h3M3 3v13a2 2 0 0 0 2 2h3', key: '2' }],
]);

export type RowIcon = LucideIcon | typeof BotFilled;

/** A finished step shows what it was. */
export const KIND_ICONS: Record<ToolKind, RowIcon> = {
  read: FileText,
  edit: Diff,
  write: WriteIcon,
  glob: Search,
  grep: Search,
  list: ListTreeIcon,
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
