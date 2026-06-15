import { Loader2 } from 'lucide-react';
import { useTunnelStatus } from './use-tunnel-status';
import { TunnelControl } from './TunnelControl';

interface RemoteAccessPaneProps {
  port: number;
}

export function RemoteAccessPane({ port }: RemoteAccessPaneProps): React.ReactElement {
  const tunnel = useTunnelStatus(port);

  if (tunnel.loading) {
    return (
      <div data-testid="settings-pane-remote-access" className="space-y-6">
        <h3 className="text-mf-heading font-semibold text-mf-text-primary">Remote Access</h3>
        <div className="flex items-center gap-2 text-mf-small text-mf-text-secondary">
          <Loader2 size={14} className="animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div data-testid="settings-pane-remote-access" className="space-y-6">
      <h3 className="text-mf-heading font-semibold text-mf-text-primary">Remote Access</h3>
      <TunnelControl tunnel={tunnel} port={port} />
    </div>
  );
}
