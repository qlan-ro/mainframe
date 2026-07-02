/**
 * DaemonUnreachableBody — inner card for when a remote daemon is unreachable.
 *
 * Rendered INSIDE ConnectionOverlay's body slot (not itself a Dialog).
 * Shows an amber spinner ring, title, body copy, indeterminate progress bar,
 * and a "Switch to This Mac" action.
 *
 * Visual spec: 17-daemon.jsx DaemonUnreachableBody artboard.
 * Token mapping: task-B8-brief.md.
 */
import { Server, Laptop } from 'lucide-react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DaemonUnreachableBodyProps {
  target: DaemonMeta;
  onSwitchLocal: () => void;
}

// ---------------------------------------------------------------------------
// AmberSpinner — ring with a Server glyph centered
// ---------------------------------------------------------------------------

function AmberSpinner() {
  return (
    <div className="relative flex size-[46px] shrink-0 items-center justify-center">
      {/* Track ring */}
      <div className="absolute inset-0 rounded-full border-[2px] border-border" />
      {/* Spinning amber arc */}
      <div className="absolute inset-0 rounded-full border-[2px] border-transparent border-t-mf-warning animate-spin" />
      {/* Center glyph */}
      <Server size={16} className="relative text-mf-warning" aria-hidden />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DaemonUnreachableBody
// ---------------------------------------------------------------------------

export function DaemonUnreachableBody({ target, onSwitchLocal }: DaemonUnreachableBodyProps) {
  return (
    <div
      data-testid="daemon-unreachable"
      className="flex flex-col items-center gap-[16px] rounded-[13px] bg-background border-[0.5px] border-mf-border-hover min-w-[320px] pt-[30px] px-[38px] pb-[26px] text-center"
      style={{ boxShadow: 'var(--mf-shadow-modal)' }}
    >
      <AmberSpinner />

      {/* Text */}
      <div className="flex flex-col gap-[5px]">
        <p className="text-heading font-semibold text-foreground tracking-tight">Can't reach {target.label}</p>
        <p className="text-label text-muted-foreground leading-normal max-w-[248px]">
          Retrying over the tunnel. This usually means the server is offline or the tunnel restarted.
        </p>
        {target.host != null && <p className="font-mono text-caption text-mf-text-3 mt-[2px]">{target.host}</p>}
      </div>

      {/* Indeterminate progress bar */}
      <div className="w-[200px] h-[3px] rounded-[2px] overflow-hidden bg-mf-warning/20">
        <div className="w-[40%] h-full rounded-[2px] bg-mf-warning animate-[ws-indeterminate_1.5s_ease-in-out_infinite]" />
      </div>

      {/* Action */}
      <Button data-testid="daemon-unreachable-switchlocal" className="w-full" onClick={onSwitchLocal}>
        <Laptop size={14} aria-hidden />
        Switch to This Mac
      </Button>
    </div>
  );
}
