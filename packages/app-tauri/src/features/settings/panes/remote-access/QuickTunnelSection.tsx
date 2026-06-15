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
          <label className="text-mf-small text-mf-text-secondary">Quick Tunnel</label>
          <p className="text-mf-status text-mf-text-tertiary mt-0.5">
            Ephemeral tunnel via trycloudflare.com (new URL each start).
          </p>
        </div>
        <button
          data-testid="quick-tunnel-toggle"
          onClick={handleToggle}
          disabled={tunnel.togglingAction !== null}
          className={`px-3 py-1.5 text-mf-small rounded-mf-input transition-colors disabled:opacity-50 ${
            tunnel.running
              ? 'bg-mf-hover text-mf-text-primary border border-mf-divider hover:bg-mf-hover/80'
              : 'bg-mf-accent text-white hover:opacity-90'
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
      {tunnel.state === 'error' && tunnel.errorMsg && <p className="text-mf-small text-red-500">{tunnel.errorMsg}</p>}
    </div>
  );
}
