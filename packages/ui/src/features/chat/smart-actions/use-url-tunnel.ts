/**
 * The URL chip's behaviour (#279), kept out of the component so the chip stays
 * presentational.
 *
 * Every transition rides `tunnel:status` events through `store/port-tunnels`;
 * the start POST is only a trigger. `TunnelManager::start` resolves after DNS
 * verification (~45 s), so gating anything on it would pin `tunnelling…` long
 * after a usable URL exists.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHost } from '@/lib/host';
import { mfToast } from '@/lib/toast';
import { startPortTunnel, stopPortTunnel } from '@/lib/api/tunnel-ports';
import { usePortTunnel, reportPortTunnelError, type PortTunnelEntry } from '@/store/port-tunnels';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { useChatId } from '@/features/chat/tools/chat-tool-context';

export interface UrlTunnelController {
  isLocal: boolean;
  entry: PortTunnelEntry | undefined;
  /** Disabled while a start is in flight or the daemon reports `starting`. */
  busy: boolean;
  open: () => void;
  stop: () => void;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useUrlTunnel(href: string, port: number): UrlTunnelController {
  const host = useHost();
  const daemonPort = useDaemonPort();
  const isLocal = useDaemonIsLocal();
  const chatId = useChatId();
  const entry = usePortTunnel(port);

  // Set on the click that starts a tunnel, so only the chip the user clicked
  // opens a window when the port goes ready — other chips for the same port
  // just follow the state.
  const pendingOpenRef = useRef(false);
  const [starting, setStarting] = useState(false);

  const openExternal = useCallback(
    (url: string) => {
      host.shell.openExternal(url).catch(() => console.warn('[smart-actions] openExternal failed', url));
    },
    [host],
  );

  useEffect(() => {
    if (!entry) return;
    if (entry.state === 'ready' && pendingOpenRef.current) {
      pendingOpenRef.current = false;
      setStarting(false);
      if (entry.url) openExternal(entry.url);
      mfToast.success(`Tunnel open — anyone with this link can reach port ${port} on the daemon machine`);
      return;
    }
    if (entry.state === 'error') {
      pendingOpenRef.current = false;
      setStarting(false);
    }
  }, [entry, openExternal, port]);

  const open = useCallback(() => {
    if (isLocal) {
      openExternal(href);
      return;
    }
    if (entry?.state === 'ready' && entry.url) {
      openExternal(entry.url);
      return;
    }
    if (!chatId) {
      console.warn('[smart-actions] no chat id in scope; cannot start a port tunnel');
      return;
    }
    pendingOpenRef.current = true;
    setStarting(true);
    startPortTunnel(daemonPort, { port, chatId }).catch((err: unknown) => {
      pendingOpenRef.current = false;
      setStarting(false);
      // This chip's start failed; the daemon said nothing. Marking the entry
      // client-written keeps it out of a URL tab's claim evidence (#281 D10).
      reportPortTunnelError(port, message(err), 'client');
    });
  }, [chatId, daemonPort, entry, href, isLocal, openExternal, port]);

  const stop = useCallback(() => {
    // No optimistic removal: the entry clears on the daemon's `stopped` event,
    // so a failed stop leaves the chip honest about the tunnel still being up.
    stopPortTunnel(daemonPort, port).catch((err: unknown) => {
      mfToast.error(`Couldn’t stop the tunnel on port ${port}`, { description: message(err) });
    });
  }, [daemonPort, port]);

  return { isLocal, entry, busy: starting || entry?.state === 'starting', open, stop };
}
