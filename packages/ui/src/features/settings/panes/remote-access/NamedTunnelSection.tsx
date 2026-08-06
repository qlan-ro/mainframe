import { useState, useEffect, useCallback } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Input } from '@v2/components/ui/input';
import { Label } from '@v2/components/ui/label';
import { TunnelStatusRow } from './TunnelStatusRow';
import type { UseTunnelStatusResult } from './use-tunnel-status';

interface NamedTunnelSectionProps {
  tunnel: UseTunnelStatusResult;
  hasConfig: boolean;
  savedUrl: string | null;
  onConfigSaved: (url: string) => void;
  onConfigCleared: () => void;
}

export function NamedTunnelSection({
  tunnel,
  hasConfig,
  savedUrl,
  onConfigSaved,
  onConfigCleared,
}: NamedTunnelSectionProps): React.ReactElement {
  const [token, setToken] = useState('');
  const [url, setUrl] = useState(savedUrl ?? '');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (savedUrl) setUrl(savedUrl);
  }, [savedUrl]);

  const handleSaveAndStart = useCallback(async () => {
    if (!token.trim() || !url.trim()) return;
    setSaveError(null);
    const result = await tunnel.start({ token: token.trim(), url: url.trim() });
    if (result) {
      onConfigSaved(url.trim());
      setToken('');
    } else {
      setSaveError(tunnel.errorMsg ?? 'Failed to save and start named tunnel');
    }
  }, [token, url, tunnel, onConfigSaved]);

  const handleClear = useCallback(async () => {
    setSaveError(null);
    await tunnel.stop({ clearConfig: true });
    onConfigCleared();
    setUrl('');
  }, [tunnel, onConfigCleared]);

  const handleStartStop = useCallback(async () => {
    if (tunnel.running) {
      await tunnel.stop();
    } else if (savedUrl) {
      await tunnel.start();
    }
  }, [tunnel, savedUrl]);

  return (
    <div data-testid="settings-remote-access-named-tunnel-section" className="flex flex-col gap-3">
      <div>
        <Label className="text-xs font-medium text-muted-foreground">Named Tunnel</Label>
        <p className="text-xs text-muted-foreground mt-0.5">Use a Cloudflare connector token for a persistent URL.</p>
      </div>

      {hasConfig && savedUrl ? (
        <NamedTunnelConfigured
          tunnel={tunnel}
          savedUrl={savedUrl}
          saveError={saveError}
          onStartStop={handleStartStop}
          onClear={handleClear}
        />
      ) : (
        <NamedTunnelSetup
          token={token}
          url={url}
          saveError={saveError}
          togglingStart={tunnel.togglingAction === 'start'}
          onTokenChange={setToken}
          onUrlChange={setUrl}
          onSave={handleSaveAndStart}
        />
      )}
    </div>
  );
}

function NamedTunnelConfigured({
  tunnel,
  savedUrl,
  saveError,
  onStartStop,
  onClear,
}: {
  tunnel: UseTunnelStatusResult;
  savedUrl: string;
  saveError: string | null;
  onStartStop: () => void;
  onClear: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {tunnel.state === 'idle' || tunnel.state === 'error' ? (
        <div className="flex items-center gap-2 p-2.5 bg-card border border-border rounded-md">
          <span className="size-2 rounded-full bg-muted-foreground shrink-0" />
          <code className="text-xs text-muted-foreground truncate flex-1">{savedUrl}</code>
          <span className="text-xs text-muted-foreground shrink-0">
            {tunnel.state === 'error' ? 'Stopped (error)' : 'Stopped'}
          </span>
        </div>
      ) : (
        <TunnelStatusRow state={tunnel.state} url={tunnel.url ?? savedUrl} onRetryVerify={tunnel.retryVerify} />
      )}
      {tunnel.state === 'error' && tunnel.errorMsg && <p className="text-xs text-destructive">{tunnel.errorMsg}</p>}
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={tunnel.running ? 'outline' : 'default'}
          data-testid="named-tunnel-toggle"
          onClick={onStartStop}
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
        <Button
          size="sm"
          variant="outline"
          data-testid="named-tunnel-clear-config"
          onClick={onClear}
          disabled={tunnel.togglingAction === 'stop'}
          className="text-muted-foreground"
        >
          Clear Configuration
        </Button>
      </div>
    </div>
  );
}

function NamedTunnelSetup({
  token,
  url,
  saveError,
  togglingStart,
  onTokenChange,
  onUrlChange,
  onSave,
}: {
  token: string;
  url: string;
  saveError: string | null;
  togglingStart: boolean;
  onTokenChange: (v: string) => void;
  onUrlChange: (v: string) => void;
  onSave: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <Input
        data-testid="named-tunnel-token-input"
        type="password"
        value={token}
        onChange={(e) => onTokenChange(e.target.value)}
        placeholder="Cloudflare connector token"
        className="h-8"
      />
      <Input
        data-testid="named-tunnel-url-input"
        type="text"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="https://mainframe.example.com"
        className="h-8"
      />
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      <Button
        size="sm"
        data-testid="named-tunnel-save"
        onClick={onSave}
        disabled={togglingStart || !token.trim() || !url.trim()}
      >
        {togglingStart ? (
          <span className="flex items-center gap-1.5">
            <RotateCw className="animate-spin" />
            Saving...
          </span>
        ) : (
          'Save & Start'
        )}
      </Button>
    </div>
  );
}
