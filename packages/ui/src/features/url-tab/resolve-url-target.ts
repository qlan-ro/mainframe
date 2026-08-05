/**
 * resolveUrlTabTarget / composeTunnelUrl — pure tunnel-state resolution for a
 * `url` workspace tab (#281). Table-drives the priority-ordered contract below over
 * a snapshot of the port-tunnels store, this tab's own start attempt, and its
 * watchdog — never touches the store directly, so every case is a pure input.
 */
import { classifyLocalhostUrl, isTunnelEligiblePort } from '@qlan-ro/mainframe-types';
import { normalizePreviewUrl } from '../preview/normalize-url';
import type { PortTunnelEntry } from '../../store/port-tunnels';

export type UrlTabTarget =
  | { kind: 'direct'; url: string }
  | { kind: 'tunnelled'; url: string }
  | { kind: 'pending'; port: number }
  | { kind: 'rejected'; port: number; reason: string }
  | { kind: 'failed'; error: string }
  | { kind: 'stopped'; port: number }
  | { kind: 'invalid'; url: string };

export interface UrlTabTunnelInput {
  /** Normalized, user-committed address. */
  url: string;
  isLocal: boolean;
  /** The daemon's own port from the tunnel snapshot — not the HTTP client port. */
  daemonPort: number | null;
  entry: PortTunnelEntry | undefined;
  /** This tab attached while the tunnel was absent or starting (it owns the in-flight start). */
  watching: boolean;
  /** The URL this tab's own POST /tunnel/ports/start returned. */
  startUrl: string | null;
  /** The 120s watchdog fired. */
  timedOut: boolean;
  /** An entry existed for this port during this attempt and then disappeared. */
  everHadEntry: boolean;
}

export const URL_TAB_TUNNEL_TIMEOUT_MS = 120_000;

/** The daemon's own rejection strings, verbatim — `null` when the port is tunnel-eligible. */
export function portRejectionReason(port: number, daemonPort: number): string | null {
  if (port < 1024) return 'Port must be 1024 or higher';
  if (port === daemonPort) return "Cannot tunnel the daemon's own port";
  if (!isTunnelEligiblePort(port, daemonPort)) return `Port ${port} cannot be tunnelled`;
  return null;
}

/** Steps 5–8: what to show once the URL is loopback, has a daemon port, and is tunnel-eligible. */
function resolveEntryTarget(input: UrlTabTunnelInput, port: number): UrlTabTarget {
  const { entry, watching, startUrl, timedOut, everHadEntry, url } = input;

  if (entry === undefined) {
    if (everHadEntry) return { kind: 'stopped', port };
    return startUrl !== null ? { kind: 'tunnelled', url: composeTunnelUrl(startUrl, url) } : { kind: 'pending', port };
  }

  if (entry.state === 'error') return { kind: 'failed', error: entry.error ?? 'Tunnel failed to start' };

  const tunnelOrigin = entry.state === 'ready' ? (entry.url ?? startUrl) : undefined;
  const gateOpen = !watching || startUrl !== null || entry.dnsVerified === true;
  if (tunnelOrigin && gateOpen) return { kind: 'tunnelled', url: composeTunnelUrl(tunnelOrigin, url) };

  if (timedOut) return { kind: 'failed', error: 'The tunnel did not produce a URL within 120 seconds' };
  return { kind: 'pending', port };
}

export function resolveUrlTabTarget(input: UrlTabTunnelInput): UrlTabTarget {
  const { url, isLocal, daemonPort } = input;
  if (normalizePreviewUrl(url) === null) return { kind: 'invalid', url };
  if (isLocal) return { kind: 'direct', url };

  const local = classifyLocalhostUrl(url);
  if (local === null) return { kind: 'direct', url };
  if (daemonPort === null) return { kind: 'pending', port: local.port };

  const reason = portRejectionReason(local.port, daemonPort);
  if (reason !== null) return { kind: 'rejected', port: local.port, reason };

  return resolveEntryTarget(input, local.port);
}

/** Append the path/query/hash of `originalUrl` onto `tunnelOrigin`; unparsable input passes through unchanged. */
export function composeTunnelUrl(tunnelOrigin: string, originalUrl: string): string {
  try {
    const tunnel = new URL(tunnelOrigin);
    const original = new URL(originalUrl);
    return `${tunnel.origin}${original.pathname}${original.search}${original.hash}`;
  } catch {
    /* expected: defensive only — both inputs come from already-validated sources */
    return tunnelOrigin;
  }
}
