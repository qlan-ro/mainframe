/**
 * The panel body for a run with no recoverable structure (AC 19, D15): an
 * interrupted run whose CLI and daemon have both restarted leaves nothing behind.
 * Say that, rather than dressing a zeroed run as data.
 */
import { FileWarning } from 'lucide-react';

export function WorkflowRunUnavailable() {
  return (
    <div className="flex items-start gap-2 px-1.5 py-2">
      <FileWarning size={13} className="mt-px shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-label text-foreground">Run details unavailable</p>
        <p className="mt-1 text-caption leading-normal text-muted-foreground">
          This run was interrupted before it finished, and both the CLI and the daemon have restarted since. No snapshot
          survives, and the CLI writes a run record only on completion.
        </p>
      </div>
    </div>
  );
}
