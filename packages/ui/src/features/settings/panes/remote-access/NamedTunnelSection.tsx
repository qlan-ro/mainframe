import { useState, useEffect, useCallback } from 'react';
import { RotateCw } from 'lucide-react';
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
    <div data-testid="settings-remote-access-named-tunnel-section" className="space-y-3">
      <div>
        <label className="text-label font-semibold text-muted-foreground">Named Tunnel</label>
        <p className="text-label text-muted-foreground mt-0.5">
          Use a Cloudflare connector token for a persistent URL.
        </p>
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
    <div className="space-y-2">
      {tunnel.state === 'idle' || tunnel.state === 'error' ? (
        <div className="flex items-center gap-2 p-2.5 bg-card border border-border rounded-md">
          <span className="w-2 h-2 rounded-full bg-muted-foreground shrink-0" />
          <code className="text-label text-muted-foreground truncate flex-1">{savedUrl}</code>
          <span className="text-caption text-muted-foreground shrink-0">
            {tunnel.state === 'error' ? 'Stopped (error)' : 'Stopped'}
          </span>
        </div>
      ) : (
        <TunnelStatusRow state={tunnel.state} url={tunnel.url ?? savedUrl} onRetryVerify={tunnel.retryVerify} />
      )}
      {tunnel.state === 'error' && tunnel.errorMsg && <p className="text-label text-destructive">{tunnel.errorMsg}</p>}
      {saveError && <p className="text-label text-destructive">{saveError}</p>}
      <div className="flex items-center gap-2">
        <button
          data-testid="named-tunnel-toggle"
          onClick={onStartStop}
          disabled={tunnel.togglingAction !== null}
          className={`inline-flex h-[30px] items-center justify-center px-[11px] text-label rounded-md transition-colors disabled:opacity-50 ${
            tunnel.running
              ? 'bg-accent text-foreground border border-border hover:bg-accent/80'
              : 'bg-primary text-primary-foreground hover:opacity-90'
          }`}
        >
          {tunnel.togglingAction ? (
            <span className="flex items-center gap-1.5">
              <RotateCw size={12} className="animate-spin" />
              {tunnel.togglingAction === 'stop' ? 'Stopping...' : 'Starting...'}
            </span>
          ) : tunnel.running ? (
            'Stop'
          ) : (
            'Start'
          )}
        </button>
        <button
          data-testid="named-tunnel-clear-config"
          onClick={onClear}
          disabled={tunnel.togglingAction === 'stop'}
          className="inline-flex h-[30px] items-center justify-center px-[11px] text-label text-muted-foreground bg-accent border border-border rounded-md hover:bg-accent/80 disabled:opacity-50 transition-colors"
        >
          Clear Configuration
        </button>
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
    <div className="space-y-2">
      <input
        data-testid="named-tunnel-token-input"
        type="password"
        value={token}
        onChange={(e) => onTokenChange(e.target.value)}
        placeholder="Cloudflare connector token"
        className="h-[30px] w-full px-[11px] text-body bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
      />
      <input
        data-testid="named-tunnel-url-input"
        type="text"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="https://mainframe.example.com"
        className="h-[30px] w-full px-[11px] text-body bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
      />
      {saveError && <p className="text-label text-destructive">{saveError}</p>}
      <button
        data-testid="named-tunnel-save"
        onClick={onSave}
        disabled={togglingStart || !token.trim() || !url.trim()}
        className="inline-flex h-[30px] items-center justify-center px-[11px] text-label bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {togglingStart ? (
          <span className="flex items-center gap-1.5">
            <RotateCw size={12} className="animate-spin" />
            Saving...
          </span>
        ) : (
          'Save & Start'
        )}
      </button>
    </div>
  );
}
