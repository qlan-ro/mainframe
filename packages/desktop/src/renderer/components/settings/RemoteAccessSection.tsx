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
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:remote-access');

const PAIRING_EXPIRY_MS = 5 * 60 * 1000;

interface Device {
  deviceId: string;
  deviceName: string;
  createdAt: string;
  lastSeen: string | null;
}

export function RemoteAccessSection(): React.ReactElement {
  return (
    <div className="space-y-6">
      <h3 className="text-mf-heading font-semibold text-mf-text-primary">Remote Access</h3>
      <TunnelControl />
    </div>
  );
}

function NamedTunnelConfig({ onSaved }: { onSaved: (token: string, url: string) => void }): React.ReactElement {
  const [token, setToken] = useState('');
  const [url, setUrl] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    getTunnelConfig()
      .then((cfg) => {
        setHasToken(cfg.hasToken);
        setSavedUrl(cfg.url);
        if (cfg.url) setUrl(cfg.url);
      })
      .catch((err) => log.warn('failed to load tunnel config', { err: String(err) }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async () => {
    if (!token.trim() || !url.trim()) return;
    setSaving(true);
    try {
      await startTunnel({ token: token.trim(), url: url.trim() });
      setHasToken(true);
      setSavedUrl(url.trim());
      setToken('');
      onSaved(token.trim(), url.trim());
    } catch (err) {
      log.warn('failed to save named tunnel config', { err: String(err) });
    } finally {
      setSaving(false);
    }
  }, [token, url, onSaved]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    try {
      await stopTunnel({ clearConfig: true });
      setHasToken(false);
      setSavedUrl(null);
      setToken('');
      setUrl('');
    } catch (err) {
      log.warn('failed to clear tunnel config', { err: String(err) });
    } finally {
      setClearing(false);
    }
  }, []);

  if (loading) return <></>;

  return (
    <div className="space-y-3">
      <div>
        <label className="text-mf-small text-mf-text-secondary">Named Tunnel</label>
        <p className="text-mf-status text-mf-text-tertiary mt-0.5">
          Use a Cloudflare connector token for a persistent URL.
        </p>
      </div>

      {hasToken && savedUrl ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
            <code className="text-mf-small text-mf-text-primary truncate flex-1">{savedUrl}</code>
            <span className="text-mf-status text-mf-text-tertiary shrink-0">Token configured</span>
          </div>
          <button
            onClick={handleClear}
            disabled={clearing}
            className="px-3 py-1.5 text-mf-small text-mf-text-secondary bg-mf-hover border border-mf-divider rounded-mf-input hover:bg-mf-hover/80 disabled:opacity-50 transition-colors"
          >
            {clearing ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Clearing...
              </span>
            ) : (
              'Clear Configuration'
            )}
          </button>
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
          <button
            onClick={handleSave}
            disabled={saving || !token.trim() || !url.trim()}
            className="px-3 py-1.5 text-mf-small bg-mf-accent text-white rounded-mf-input hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? (
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

function TunnelControl(): React.ReactElement {
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const status = await getTunnelStatus();
      setRunning(status.running);
      setUrl(status.url);
      setVerified(status.verified);
    } catch (err) {
      log.warn('failed to get tunnel status', { err: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleToggle = useCallback(async () => {
    setToggling(true);
    try {
      if (running) {
        await stopTunnel();
        setRunning(false);
        setUrl(null);
      } else {
        const result = await startTunnel();
        setRunning(true);
        setUrl(result.url);
      }
    } catch (err) {
      log.warn('tunnel toggle failed', { err: String(err) });
    } finally {
      setToggling(false);
    }
  }, [running]);

  const handleNamedSaved = useCallback((_token: string, savedUrl: string) => {
    setRunning(true);
    setUrl(savedUrl);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-mf-small text-mf-text-secondary">
        <Loader2 size={14} className="animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Named tunnel config */}
      <NamedTunnelConfig onSaved={handleNamedSaved} />

      {/* Quick tunnel section */}
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
            disabled={toggling}
            className={`px-3 py-1.5 text-mf-small rounded-mf-input transition-colors disabled:opacity-50 ${
              running
                ? 'bg-mf-hover text-mf-text-primary border border-mf-divider hover:bg-mf-hover/80'
                : 'bg-mf-accent text-white hover:opacity-90'
            }`}
          >
            {toggling ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                {running ? 'Stopping...' : 'Starting...'}
              </span>
            ) : running ? (
              'Stop'
            ) : (
              'Start'
            )}
          </button>
        </div>

        {running && url && (
          <div className="flex items-center gap-2 p-2.5 bg-mf-input-bg border border-mf-divider rounded-mf-input">
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <code className="text-mf-small text-mf-text-primary truncate flex-1">{url}</code>
            <CopyButton text={url} />
          </div>
        )}
      </div>

      {/* Pairing section — only when tunnel is running and verified */}
      {running && !verified && (
        <p className="text-mf-small text-yellow-500">Tunnel unreachable — pairing unavailable</p>
      )}
      {running && verified && <PairingSection />}

      {/* Devices section */}
      <DevicesSection />
    </div>
  );
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
