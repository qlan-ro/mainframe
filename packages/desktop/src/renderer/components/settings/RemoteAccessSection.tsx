import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, Check, Trash2, Loader2 } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import {
  getTunnelStatus,
  startTunnel,
  stopTunnel,
  getTunnelConfig,
  generatePairingCode,
  getDevices,
  removeDevice,
} from '../../lib/api';
import { daemonClient } from '../../lib/client';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:remote-access');

const PAIRING_EXPIRY_MS = 5 * 60 * 1000;
/**
 * The daemon currently labels every tunnel it manages as 'daemon'. We filter
 * `tunnel:status` events by this label so the renderer is ready for additional
 * labels without code changes.
 */
const DAEMON_TUNNEL_LABEL = 'daemon';

interface Device {
  deviceId: string;
  deviceName: string;
  createdAt: string;
  lastSeen: string | null;
}

/**
 * UI states derived from the daemon's tunnel:status events plus the initial
 * REST snapshot. "ready" means the tunnel is actually reachable (DNS verified),
 * not just that cloudflared registered the connection.
 */
type TunnelUiState = 'idle' | 'starting' | 'verifying' | 'ready' | 'unreachable' | 'error';

interface UseTunnelStatusResult {
  state: TunnelUiState;
  url: string | null;
  errorMsg: string | null;
  loading: boolean;
  togglingAction: 'start' | 'stop' | null;
  running: boolean;
  verified: boolean;
  start: (opts?: { token?: string; url?: string }) => Promise<{ url: string } | null>;
  stop: (opts?: { clearConfig?: boolean }) => Promise<void>;
  retryVerify: () => Promise<void>;
}

/**
 * Subscribes to `tunnel:status` events for a single tunnel label and exposes
 * a derived state machine. Used by both the Named and Quick tunnel UIs so they
 * always agree on what the daemon is doing.
 */
function useTunnelStatus(label: string): UseTunnelStatusResult {
  const [state, setState] = useState<TunnelUiState>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingAction, setTogglingAction] = useState<'start' | 'stop' | null>(null);

  const running = state !== 'idle' && state !== 'error';
  const verified = state === 'ready';

  const refresh = useCallback(async () => {
    try {
      const status = await getTunnelStatus();
      setUrl(status.url);
      if (!status.running) setState('idle');
      else if (status.verified) setState('ready');
      else if (status.url) setState('unreachable');
      else setState('starting');
    } catch (err) {
      log.warn('failed to get tunnel status', { err: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return daemonClient.onEvent((event) => {
      if (event.type !== 'tunnel:status') return;
      if (event.label !== label) return;
      switch (event.state) {
        case 'starting':
          setState('starting');
          setUrl(null);
          setErrorMsg(null);
          break;
        case 'ready':
          setUrl(event.url ?? null);
          setState('verifying');
          setErrorMsg(null);
          break;
        case 'dns_verified':
          setUrl(event.url ?? null);
          setState(event.dnsVerified ? 'ready' : 'unreachable');
          break;
        case 'error':
          log.warn('tunnel error from daemon', { error: event.error });
          setState('error');
          setErrorMsg(event.error ?? 'Tunnel failed to start');
          setUrl(null);
          break;
        case 'stopped':
          setState('idle');
          setUrl(null);
          setErrorMsg(null);
          break;
      }
    });
  }, [label]);

  const start = useCallback(
    async (opts?: { token?: string; url?: string }): Promise<{ url: string } | null> => {
      setTogglingAction('start');
      try {
        setState('starting');
        setErrorMsg(null);
        const result = await startTunnel(opts);
        setUrl(result.url);
        // The HTTP call resolves *after* the daemon has finished its DNS verification
        // (success or timeout). If the WS was momentarily disconnected during the
        // route call, the renderer would have missed the broadcast and stayed in
        // 'starting'. Refresh from REST to converge on the daemon's actual state.
        await refresh();
        return result;
      } catch (err) {
        log.warn('tunnel start failed', { err: String(err) });
        const message = err instanceof Error ? err.message : String(err);
        setErrorMsg(message);
        setState('error');
        return null;
      } finally {
        setTogglingAction(null);
      }
    },
    [refresh],
  );

  const stop = useCallback(async (opts?: { clearConfig?: boolean }) => {
    setTogglingAction('stop');
    try {
      await stopTunnel(opts);
      setState('idle');
      setUrl(null);
      setErrorMsg(null);
    } catch (err) {
      log.warn('tunnel stop failed', { err: String(err) });
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingAction(null);
    }
  }, []);

  const retryVerify = useCallback(async () => {
    setState('verifying');
    await refresh();
  }, [refresh]);

  return { state, url, errorMsg, loading, togglingAction, running, verified, start, stop, retryVerify };
}

export function RemoteAccessSection(): React.ReactElement {
  const tunnel = useTunnelStatus(DAEMON_TUNNEL_LABEL);

  if (tunnel.loading) {
    return (
      <div className="space-y-6">
        <h3 className="text-mf-heading font-semibold text-mf-text-primary">Remote Access</h3>
        <div className="flex items-center gap-2 text-mf-small text-mf-text-secondary">
          <Loader2 size={14} className="animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="text-mf-heading font-semibold text-mf-text-primary">Remote Access</h3>
      <TunnelControl tunnel={tunnel} />
    </div>
  );
}

function TunnelControl({ tunnel }: { tunnel: UseTunnelStatusResult }): React.ReactElement {
  const [hasNamedConfig, setHasNamedConfig] = useState<boolean | null>(null);
  const [namedSavedUrl, setNamedSavedUrl] = useState<string | null>(null);

  useEffect(() => {
    getTunnelConfig()
      .then((cfg) => {
        setHasNamedConfig(cfg.hasToken);
        setNamedSavedUrl(cfg.url);
      })
      .catch((err) => log.warn('failed to load tunnel config', { err: String(err) }));
  }, []);

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

      {tunnel.verified && <PairingSection />}

      <DevicesSection />
    </div>
  );
}

function NamedTunnelSection({
  tunnel,
  hasConfig,
  savedUrl,
  onConfigSaved,
  onConfigCleared,
}: {
  tunnel: UseTunnelStatusResult;
  hasConfig: boolean;
  savedUrl: string | null;
  onConfigSaved: (url: string) => void;
  onConfigCleared: () => void;
}): React.ReactElement {
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
    <div className="space-y-3">
      <div>
        <label className="text-mf-small text-mf-text-secondary">Named Tunnel</label>
        <p className="text-mf-status text-mf-text-tertiary mt-0.5">
          Use a Cloudflare connector token for a persistent URL.
        </p>
      </div>

      {hasConfig && savedUrl ? (
        <div className="space-y-2">
          {tunnel.state === 'idle' || tunnel.state === 'error' ? (
            <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
              <span className="w-2 h-2 rounded-full bg-mf-text-tertiary opacity-60 shrink-0" />
              <code className="text-mf-small text-mf-text-secondary truncate flex-1">{savedUrl}</code>
              <span className="text-mf-status text-mf-text-tertiary shrink-0">
                {tunnel.state === 'error' ? 'Stopped (error)' : 'Stopped'}
              </span>
            </div>
          ) : (
            <TunnelStatusRow state={tunnel.state} url={tunnel.url ?? savedUrl} onRetryVerify={tunnel.retryVerify} />
          )}
          {tunnel.state === 'error' && tunnel.errorMsg && (
            <p className="text-mf-small text-red-500">{tunnel.errorMsg}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartStop}
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
            <button
              onClick={handleClear}
              disabled={tunnel.togglingAction === 'stop'}
              className="px-3 py-1.5 text-mf-small text-mf-text-secondary bg-mf-hover border border-mf-divider rounded-mf-input hover:bg-mf-hover/80 disabled:opacity-50 transition-colors"
            >
              Clear Configuration
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Cloudflare connector token"
            className="w-full px-3 py-1.5 text-mf-small bg-mf-input-bg border border-mf-divider rounded-mf-input text-mf-text-primary placeholder:text-mf-text-tertiary focus:outline-none focus:border-mf-accent"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mainframe.example.com"
            className="w-full px-3 py-1.5 text-mf-small bg-mf-input-bg border border-mf-divider rounded-mf-input text-mf-text-primary placeholder:text-mf-text-tertiary focus:outline-none focus:border-mf-accent"
          />
          {saveError && <p className="text-mf-small text-red-500">{saveError}</p>}
          <button
            onClick={handleSaveAndStart}
            disabled={tunnel.togglingAction === 'start' || !token.trim() || !url.trim()}
            className="px-3 py-1.5 text-mf-small bg-mf-accent text-white rounded-mf-input hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {tunnel.togglingAction === 'start' ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Saving...
              </span>
            ) : (
              'Save & Start'
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function QuickTunnelSection({ tunnel }: { tunnel: UseTunnelStatusResult }): React.ReactElement {
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

/**
 * Single source of truth for the tunnel-status pill (dot + URL + spinner /
 * warning) shared by Named and Quick sections so both render the same state
 * the same way.
 */
function TunnelStatusRow({
  state,
  url,
  onRetryVerify,
}: {
  state: TunnelUiState;
  url: string | null;
  onRetryVerify: () => void;
}): React.ReactElement | null {
  if (state === 'idle' || state === 'error') return null;

  if (state === 'starting' || (state === 'verifying' && !url)) {
    return (
      <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
        <Loader2 size={12} className="animate-spin text-yellow-500 shrink-0" />
        <span className="text-mf-small text-mf-text-secondary flex-1">
          {state === 'starting' ? 'Starting tunnel…' : 'Verifying DNS…'}
        </span>
      </div>
    );
  }

  if (state === 'verifying' && url) {
    return (
      <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
        <Loader2 size={12} className="animate-spin text-yellow-500 shrink-0" />
        <span className="text-mf-small text-mf-text-secondary flex-1">
          Verifying DNS for <code className="text-mf-text-primary">{url}</code>…
        </span>
      </div>
    );
  }

  if (state === 'ready' && url) {
    return (
      <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
        <code className="text-mf-small text-mf-text-primary truncate flex-1">{url}</code>
        <CopyButton text={url} />
      </div>
    );
  }

  if (state === 'unreachable' && url) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
          <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
          <code className="text-mf-small text-mf-text-secondary truncate flex-1">{url}</code>
          <CopyButton text={url} />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-mf-status text-yellow-500">
            DNS not yet propagated — tunnel may not be reachable. Pairing disabled.
          </p>
          <button onClick={onRetryVerify} className="text-mf-small text-mf-accent hover:underline shrink-0 ml-2">
            Re-check
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function PairingSection(): React.ReactElement {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [generating, setGenerating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const left = Math.max(0, expiresAt - Date.now());
      setRemaining(left);
      if (left === 0) {
        setCode(null);
        setExpiresAt(null);
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [expiresAt]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await generatePairingCode();
      setCode(result.pairingCode);
      setExpiresAt(Date.now() + PAIRING_EXPIRY_MS);
    } catch (err) {
      log.warn('failed to generate pairing code', { err: String(err) });
    } finally {
      setGenerating(false);
    }
  }, []);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-mf-small text-mf-text-secondary">Mobile Pairing</label>
        <p className="text-mf-status text-mf-text-tertiary mt-0.5">Generate a code to pair a mobile device.</p>
      </div>

      {code ? (
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-3 p-4 bg-mf-input-bg border border-mf-divider rounded-mf-input">
            <span className="text-2xl font-mono font-bold tracking-[0.3em] text-mf-text-primary">{code}</span>
            <CopyButton text={code} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-mf-status text-mf-text-tertiary">
              Expires in {minutes}:{seconds.toString().padStart(2, '0')}
            </span>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="text-mf-small text-mf-accent hover:underline disabled:opacity-50"
            >
              Generate new
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="px-3 py-1.5 text-mf-small bg-mf-accent text-white rounded-mf-input hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {generating ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Generating...
            </span>
          ) : (
            'Generate Pairing Code'
          )}
        </button>
      )}
    </div>
  );
}

function DevicesSection(): React.ReactElement {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await getDevices();
      setDevices(data);
    } catch (err) {
      log.warn('failed to load devices', { err: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRemove = useCallback(async (deviceId: string) => {
    try {
      await removeDevice(deviceId);
      setDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));
    } catch (err) {
      log.warn('failed to remove device', { err: String(err) });
    }
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-mf-small text-mf-text-secondary">Paired Devices</label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-mf-small text-mf-text-secondary">
          <Loader2 size={14} className="animate-spin" />
          Loading...
        </div>
      ) : devices.length === 0 ? (
        <p className="text-mf-status text-mf-text-tertiary">No paired devices.</p>
      ) : (
        <div className="space-y-1.5">
          {devices.map((device) => (
            <div
              key={device.deviceId}
              className="flex items-center justify-between p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input"
            >
              <div>
                <span className="text-mf-small text-mf-text-primary">{device.deviceName}</span>
                <span className="text-mf-status text-mf-text-tertiary ml-2">
                  {new Date(device.createdAt).toLocaleDateString()}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleRemove(device.deviceId)}
                    className="p-1 text-mf-text-tertiary hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Remove device</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }, [text]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleCopy}
          className="p-1 text-mf-text-tertiary hover:text-mf-text-primary transition-colors shrink-0"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </TooltipTrigger>
      <TooltipContent>Copy</TooltipContent>
    </Tooltip>
  );
}
