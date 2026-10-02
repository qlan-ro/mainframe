import { CheckIcon, CircleHelpIcon, CircleXIcon, ClockIcon, Loader2Icon, OctagonIcon } from 'lucide-react';
import type { CompactToolRow as ToolRow, ToolStatus } from '../../view-model/compact/types';
import { CompactDisclosure } from './CompactDisclosure';
import { CompactElapsed } from './CompactElapsed';
import { CompactToolDetails } from './CompactToolDetails';

const icons = {
  running: Loader2Icon,
  success: CheckIcon,
  failed: CircleXIcon,
  stopped: OctagonIcon,
  declined: OctagonIcon,
  'awaiting-approval': ClockIcon,
  unknown: CircleHelpIcon,
};
function StatusIcon({ status }: { status: ToolStatus }) {
  const Icon = icons[status];
  return (
    <Icon
      aria-label={status.replace(/-/g, ' ')}
      className={`size-3.5 shrink-0 ${status === 'failed' ? 'text-destructive' : 'text-muted-foreground'} ${status === 'running' ? 'animate-spin motion-reduce:animate-none' : ''}`}
    />
  );
}
export function CompactToolRow({ row, memberKeys }: { row: ToolRow; memberKeys: readonly string[] }) {
  const trailing = (
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
      icon={<StatusIcon status={row.status} />}
      trailing={trailing}
    >
      <CompactToolDetails indices={row.indices} />
    </CompactDisclosure>
  );
}
