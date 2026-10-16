/**
 * RailUpdateButton — the nav rail's updates affordance (the former title-bar
 * `UpdatePill`). Subscribes to host.updates.onStatus; renders NOTHING for
 * 'not-available'/'checking'/'error' (errors surface in Settings › About, not
 * here) unless a provider CLI has an update, in which case the same button
 * opens `RailUpdateMenu` listing every pending update. App-only click behaviour:
 *  - 'available'   → host.updates.download()
 *  - 'downloading' → inert (the hint carries the progress)
 *  - 'downloaded'  → host.updates.install() (restart)
 *
 * The rail has no room for a word, so the glyph carries a `primary` dot and
 * the sentence lives in the hint.
 */
import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '@qlan-ro/mainframe-types';
import { useHost } from '@/lib/host';
import { useProviderCliUpdates } from '@/store/cli-update';
import { NavRailButton } from './NavRailButton';
import { RailUpdateMenu } from './RailUpdateMenu';

function updateHint(status: UpdateStatus): string | null {
  switch (status.state) {
    case 'available':
      return `Version ${status.version} is available. Download it now — it installs on restart.`;
    case 'downloading':
      return `Downloading the update… ${Math.round(status.percent)}%`;
    case 'downloaded':
      return `Restart Mainframe to finish installing version ${status.version}.`;
    default:
      return null;
  }
}

export function RailUpdateButton() {
  const host = useHost();
  const [status, setStatus] = useState<UpdateStatus>({ state: 'not-available' });

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void host.updates.onStatus(setStatus).then((unsub) => {
      unsubscribe = unsub;
    });
    return () => unsubscribe?.();
  }, [host]);

  const clis = useProviderCliUpdates();
  const hint = updateHint(status);

  const handleClick = () => {
    if (status.state === 'available') void host.updates.download();
    else if (status.state === 'downloaded') host.updates.install();
  };

  if (clis.length > 0) {
    return <RailUpdateMenu app={status} appHint={hint} onAppAction={handleClick} clis={clis} />;
  }
  if (hint == null) return null;

  return (
    <NavRailButton
      testId="shell-rail-update"
      label={hint}
      icon={status.state === 'downloaded' ? RefreshCw : Download}
      dot
      // aria-disabled, not disabled: a disabled button swallows the pointer events its own hint needs.
      aria-disabled={status.state === 'downloading'}
      onClick={handleClick}
    />
  );
}
