import { useState, useEffect, useCallback } from 'react';
import { getTunnelConfig } from '../../../../lib/api/remote-access';
import { NamedTunnelSection } from './NamedTunnelSection';
import { QuickTunnelSection } from './QuickTunnelSection';
import { PairingSection } from './PairingSection';
import { DevicesSection } from './DevicesSection';
import type { UseTunnelStatusResult } from './use-tunnel-status';

interface TunnelControlProps {
  port: number;
  tunnel: UseTunnelStatusResult;
}

export function TunnelControl({ port, tunnel }: TunnelControlProps): React.ReactElement {
  const [hasNamedConfig, setHasNamedConfig] = useState<boolean | null>(null);
  const [namedSavedUrl, setNamedSavedUrl] = useState<string | null>(null);

  useEffect(() => {
    getTunnelConfig(port)
      .then((cfg) => {
        setHasNamedConfig(cfg.hasToken);
        setNamedSavedUrl(cfg.url);
      })
      .catch((err) => console.warn('[settings/TunnelControl] failed to load tunnel config', err));
  }, [port]);

  const handleConfigCleared = useCallback(() => {
    setHasNamedConfig(false);
    setNamedSavedUrl(null);
  }, []);

  const handleConfigSaved = useCallback((savedUrl: string) => {
    setHasNamedConfig(true);
    setNamedSavedUrl(savedUrl);
  }, []);

  if (hasNamedConfig === null) return <></>;

  return (
    <div className="space-y-6">
      <NamedTunnelSection
        tunnel={tunnel}
        hasConfig={hasNamedConfig}
        savedUrl={namedSavedUrl}
        onConfigSaved={handleConfigSaved}
        onConfigCleared={handleConfigCleared}
      />

      {/* Quick tunnel — only relevant when no named config exists. With a token,
          the daemon already runs the named tunnel, and exposing a second control
          for the same underlying tunnel would be confusing. */}
      {!hasNamedConfig && <QuickTunnelSection tunnel={tunnel} />}

      {tunnel.verified && <PairingSection port={port} />}
      <DevicesSection port={port} />
    </div>
  );
}
