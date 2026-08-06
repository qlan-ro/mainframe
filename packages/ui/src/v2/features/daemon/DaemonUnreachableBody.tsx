/**
 * The card shown while the active REMOTE daemon is unreachable — rendered
 * inside `ConnectionOverlay`'s body slot (the overlay itself is still the
 * legacy app-level one; it ports with the window-states pass).
 *
 * Warning-toned on purpose: the daemon being down is wrong-but-not-broken —
 * the app is retrying and offers the local fallback.
 */
import { LaptopIcon, ServerIcon } from 'lucide-react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { Button } from '@v2/components/ui/button';

function WarningSpinner() {
  return (
    <div className="relative flex size-11 shrink-0 items-center justify-center">
      <div className="absolute inset-0 rounded-full border-2 border-border" />
      <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-warning" />
      <ServerIcon className="relative size-4 text-warning" aria-hidden />
    </div>
  );
}

export interface DaemonUnreachableBodyProps {
  target: DaemonMeta;
  onSwitchLocal: () => void;
}

export function DaemonUnreachableBody({ target, onSwitchLocal }: DaemonUnreachableBodyProps) {
  return (
    <div
      data-testid="daemon-unreachable"
      className="flex min-w-80 flex-col items-center gap-4 rounded-xl border bg-popover px-9 pt-7 pb-6 text-center shadow-lg"
    >
      <WarningSpinner />

      <div className="flex flex-col gap-1">
        <p className="font-semibold text-foreground">Can't reach {target.label}</p>
        <p className="max-w-64 text-xs text-muted-foreground">
          Retrying over the tunnel. This usually means the server is offline or the tunnel restarted.
        </p>
        {target.host != null && <p className="mt-0.5 font-mono text-xs text-muted-foreground">{target.host}</p>}
      </div>

      <div className="h-1 w-48 overflow-hidden rounded-full bg-warning/20">
        <div className="h-full w-2/5 rounded-full bg-warning animate-[ws-indeterminate_1.5s_ease-in-out_infinite]" />
      </div>

      <Button data-testid="daemon-unreachable-switchlocal" className="w-full" onClick={onSwitchLocal}>
        <LaptopIcon aria-hidden />
        Switch to This Mac
      </Button>
    </div>
  );
}
