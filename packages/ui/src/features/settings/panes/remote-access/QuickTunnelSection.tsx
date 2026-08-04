import { useCallback } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Label } from '@v2/components/ui/label';
import { TunnelStatusRow } from './TunnelStatusRow';
import type { UseTunnelStatusResult } from './use-tunnel-status';

interface QuickTunnelSectionProps {
  tunnel: UseTunnelStatusResult;
}

export function QuickTunnelSection({ tunnel }: QuickTunnelSectionProps): React.ReactElement {
  const handleToggle = useCallback(async () => {
    if (tunnel.running) await tunnel.stop();
    else await tunnel.start();
  }, [tunnel]);

  return (
    <div data-testid="settings-remote-access-quick-tunnel-section" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs font-medium text-muted-foreground">Quick Tunnel</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ephemeral tunnel via trycloudflare.com (new URL each start).
          </p>
        </div>
        <Button
          size="sm"
          variant={tunnel.running ? 'outline' : 'default'}
          data-testid="quick-tunnel-toggle"
          onClick={handleToggle}
          disabled={tunnel.togglingAction !== null}
        >
          {tunnel.togglingAction ? (
            <span className="flex items-center gap-1.5">
              <RotateCw className="animate-spin" />
              {tunnel.togglingAction === 'stop' ? 'Stopping...' : 'Starting...'}
            </span>
          ) : tunnel.running ? (
            'Stop'
          ) : (
            'Start'
          )}
        </Button>
      </div>

      <TunnelStatusRow state={tunnel.state} url={tunnel.url} onRetryVerify={tunnel.retryVerify} />
      {tunnel.state === 'error' && tunnel.errorMsg && <p className="text-xs text-destructive">{tunnel.errorMsg}</p>}
    </div>
  );
}
