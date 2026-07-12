/**
 * UpdatePill — sidebar-header chrome pill surfacing the host auto-updater
 * lifecycle (finding 1.3, 2026-07-02 audit). Subscribes to host.updates.onStatus;
 * hidden for 'not-available'/'checking'/'error' (no actionable affordance for
 * those states in this chrome slot — errors are surfaced via the Settings
 * About pane, not here). Click behavior:
 *  - 'available'  → triggers host.updates.download().
 *  - 'downloading' → inert (progress label only).
 *  - 'downloaded' → triggers host.updates.install() (restart).
 */
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { UpdateStatus } from '@qlan-ro/mainframe-types';
import { useHost } from '@/lib/host';

function pillLabel(status: UpdateStatus): string | null {
  switch (status.state) {
    case 'available':
      return `Install update — v${status.version} is available`;
    case 'downloading':
      return `Downloading update — ${Math.round(status.percent)}%`;
    case 'downloaded':
      return 'Restart to update';
    default:
      return null;
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

  return (
    <button
      data-testid="sidebar-update-pill"
      type="button"
      onClick={handleClick}
      disabled={status.state === 'downloading'}
      className="inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-[11px] bg-primary/[0.08] px-2.5 text-label font-semibold tracking-normal text-primary transition-colors hover:bg-primary/[0.14] disabled:cursor-default"
    >
      <Download className="size-[12px]" aria-hidden />
      <span>{label}</span>
    </button>
  );
}
