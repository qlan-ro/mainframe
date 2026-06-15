import { useCallback } from 'react';
import { Loader2 } from 'lucide-react';
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-caption text-muted-foreground">Quick Tunnel</label>
          <p className="text-micro text-muted-foreground mt-0.5">
            Ephemeral tunnel via trycloudflare.com (new URL each start).
          </p>
        </div>
        <button
          data-testid="quick-tunnel-toggle"
          onClick={handleToggle}
          disabled={tunnel.togglingAction !== null}
          className={`px-3 py-1.5 text-caption rounded-md transition-colors disabled:opacity-50 ${
            tunnel.running
              ? 'bg-accent text-foreground border border-border hover:bg-accent/80'
              : 'bg-primary text-primary-foreground hover:opacity-90'
          }`}
        >
          {tunnel.togglingAction ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              {tunnel.togglingAction === 'stop' ? 'Stopping...' : 'Starting...'}
            </span>
          ) : tunnel.running ? (
            'Stop'
          ) : (
            'Start'
          )}
        </button>
      </div>

      <TunnelStatusRow state={tunnel.state} url={tunnel.url} onRetryVerify={tunnel.retryVerify} />
      {tunnel.state === 'error' && tunnel.errorMsg && (
        <p className="text-caption text-destructive">{tunnel.errorMsg}</p>
      )}
    </div>
  );
}
