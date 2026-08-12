/**
 * UpdatePill — sidebar-header chrome pill surfacing the host auto-updater
 * lifecycle (finding 1.3, 2026-07-02 audit). Subscribes to host.updates.onStatus;
 * hidden for 'not-available'/'checking'/'error' (no actionable affordance for
 * those states in this chrome slot — errors are surfaced via the Settings
 * About pane, not here). Click behavior:
 *  - 'available'  → triggers host.updates.download().
 *  - 'downloading' → inert (progress label only).
 *  - 'downloaded' → triggers host.updates.install() (restart).
 *
 * Labels are one word wide on purpose: the pill shares the title-bar row with
 * the traffic-light reserve and the header actions, which leave it under 100px
 * at the default 16rem sidebar. The sentence lives in the hint.
 */
import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '@qlan-ro/mainframe-types';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/hint';
import { useHost } from '@/lib/host';

function pillLabel(status: UpdateStatus): string | null {
  switch (status.state) {
    case 'available':
      return 'Update';
    case 'downloading':
      return `${Math.round(status.percent)}%`;
    case 'downloaded':
      return 'Restart';
    default:
      return null;
  }
}

function pillHint(status: UpdateStatus): string | undefined {
  switch (status.state) {
    case 'available':
      return `Version ${status.version} is available. Download it now — it installs on restart.`;
    case 'downloading':
      return 'Downloading the update…';
    case 'downloaded':
      return `Restart Mainframe to finish installing version ${status.version}.`;
    default:
      return undefined;
  }
}

export function UpdatePill() {
  const host = useHost();
  const [status, setStatus] = useState<UpdateStatus>({ state: 'not-available' });

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void host.updates.onStatus(setStatus).then((unsub) => {
      unsubscribe = unsub;
    });
    return () => unsubscribe?.();
  }, [host]);

  const label = pillLabel(status);
  if (label == null) return null;

  const handleClick = () => {
    if (status.state === 'available') void host.updates.download();
    else if (status.state === 'downloaded') host.updates.install();
  };

  const Icon = status.state === 'downloaded' ? RefreshCw : Download;

  return (
    <Hint label={pillHint(status)} side="bottom">
      {/* Tinted over `default`, not `ghost`: ghost's `dark:hover:bg-muted/50` is a variant twMerge can't dedupe. */}
      <Badge
        asChild
        className="min-w-0 shrink bg-primary/10 text-primary hover:bg-primary/15 aria-disabled:hover:bg-primary/10"
      >
        {/* aria-disabled, not disabled: a disabled button swallows the pointer events its own hint needs. */}
        <button
          data-testid="sidebar-update-pill"
          type="button"
          onClick={handleClick}
          aria-disabled={status.state === 'downloading'}
        >
          <Icon aria-hidden />
          <span className="truncate">{label}</span>
        </button>
      </Badge>
    </Hint>
  );
}
