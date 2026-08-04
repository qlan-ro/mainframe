/**
 * Active port tunnels (#279) — the global kill switch for the in-chat chips.
 *
 * The chips alone leave gaps: the owning chat can be archived while the scope
 * stays alive, another client on a shared daemon can open a tunnel into this
 * machine, and local-daemon chips deliberately say nothing about tunnels. So
 * this list renders regardless of daemon locality, and reads the same store the
 * chips do — no second fetch path.
 */
import { useCallback } from 'react';
import { Unplug } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { Label } from '@v2/components/ui/label';
import { mfToast } from '@/lib/toast';
import { stopPortTunnel } from '@/lib/api/tunnel-ports';
import { usePortTunnelList, type PortTunnelListEntry } from '@/store/port-tunnels';

interface ActivePortTunnelsSectionProps {
  port: number;
}

export function ActivePortTunnelsSection({ port }: ActivePortTunnelsSectionProps): React.ReactElement | null {
  const tunnels = usePortTunnelList();

  const handleStop = useCallback(
    (tunnelPort: number) => {
      // The row clears on the daemon's `stopped` event, never optimistically —
      // a failed stop must not hide a tunnel that is still public.
      stopPortTunnel(port, tunnelPort).catch((err: unknown) => {
        mfToast.error(`Couldn’t stop the tunnel on port ${tunnelPort}`, {
          description: err instanceof Error ? err.message : String(err),
        });
      });
    },
    [port],
  );

  if (tunnels.length === 0) return null;

  return (
    <div data-testid="settings-remote-access-port-tunnels-section" className="flex flex-col gap-3">
      <div>
        <Label className="text-xs font-medium text-muted-foreground">Active Port Tunnels</Label>
      </div>

      <div className="flex flex-col gap-1.5">
        {tunnels.map((tunnel) => (
          <PortTunnelRow key={tunnel.port} tunnel={tunnel} onStop={handleStop} />
        ))}
      </div>
    </div>
  );
}

function PortTunnelRow({
  tunnel,
  onStop,
}: {
  tunnel: PortTunnelListEntry;
  onStop: (port: number) => void;
}): React.ReactElement {
  const detail = tunnel.url ?? (tunnel.state === 'error' ? (tunnel.error ?? 'Failed') : 'Starting…');

  return (
    <div className="flex items-center justify-between gap-2 p-2.5 bg-card border border-border rounded-md">
      <div className="min-w-0">
        <span className="text-xs text-foreground">Port {tunnel.port}</span>
        <span className="text-xs text-muted-foreground ml-2 break-all">{detail}</span>
      </div>
      <Hint label="Stop tunnel">
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid={`remote-access-port-tunnel-stop-${tunnel.port}`}
          onClick={() => onStop(tunnel.port)}
          aria-label="Stop tunnel"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Unplug />
        </Button>
      </Hint>
    </div>
  );
}
