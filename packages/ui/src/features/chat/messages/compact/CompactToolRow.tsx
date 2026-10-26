import {
  Bot,
  CircleHelpIcon,
  CircleXIcon,
  ClockIcon,
  FileDiffIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  Loader2Icon,
  OctagonIcon,
  PlugIcon,
  SearchIcon,
  Terminal,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CompactToolRow as ToolRow, ToolKind, ToolStatus } from '../../view-model/compact/types';
import { CompactDisclosure } from './CompactDisclosure';
import { CompactElapsed } from './CompactElapsed';
import { CompactToolDetails } from './CompactToolDetails';
import { TurnStatusTrailing } from '../../thread/TurnStatusRow';
import { useTurnStatusHost } from '../../thread/turn-status-host';

// A finished call shows what it was (the matching tool card's icon); only other states get a status glyph.
export const kindIcons: Record<ToolKind, LucideIcon> = {
  read: FileTextIcon,
  edit: FileDiffIcon,
  write: FileDiffIcon,
  glob: SearchIcon,
  grep: SearchIcon,
  list: FolderIcon,
  'web-search': GlobeIcon,
  fetch: GlobeIcon,
  shell: Terminal,
  subagent: Bot,
  mcp: PlugIcon,
  unknown: WrenchIcon,
};
const statusIcons: Record<Exclude<ToolStatus, 'success'>, LucideIcon> = {
  running: Loader2Icon,
  failed: CircleXIcon,
  stopped: OctagonIcon,
  declined: OctagonIcon,
  'awaiting-approval': ClockIcon,
  unknown: CircleHelpIcon,
};
function StatusIcon({ status, kind }: { status: ToolStatus; kind: ToolKind }) {
  const Icon = status === 'success' ? kindIcons[kind] : statusIcons[status];
  return (
    <Icon
      aria-label={status.replace(/-/g, ' ')}
      className={cn(
        'size-3.5 shrink-0 text-muted-foreground',
        status === 'failed' && 'text-destructive',
        status === 'awaiting-approval' && 'text-warning',
        status === 'running' && 'animate-spin motion-reduce:animate-none',
      )}
    />
  );
}
export function CompactToolRow({ row, memberKeys }: { row: ToolRow; memberKeys: readonly string[] }) {
  // A running row ending the transcript hosts the turn's status: the turn clock replaces its own.
  const host = useTurnStatusHost();
  const hostsTurnStatus = host !== null && memberKeys.includes(host);
  const trailing = hostsTurnStatus ? (
    <TurnStatusTrailing />
  ) : (
    <>
      {row.diff && (
        <span className="shrink-0 font-mono text-xs">
          +{row.diff.added}/-{row.diff.removed}
        </span>
      )}
      <CompactElapsed
        timing={row.timing}
        running={row.status === 'running'}
        reportedDurationMs={row.reportedDurationMs}
      />
    </>
  );
  return (
    <CompactDisclosure
      memberKeys={memberKeys}
      label={row.label}
      live={hostsTurnStatus}
      icon={<StatusIcon status={row.status} kind={row.kind} />}
      trailing={trailing}
    >
      <CompactToolDetails indices={row.indices} />
    </CompactDisclosure>
  );
}
