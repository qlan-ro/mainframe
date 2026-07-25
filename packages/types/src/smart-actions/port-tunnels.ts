/**
 * Localhost-URL classification and the `/api/tunnel/ports` wire contract for
 * the in-chat tunnel chips (#279). Pure and React-free.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

/**
 * Reads the effective port out of a loopback http(s) URL. Classification
 * only — whether that port may be tunnelled is {@link isTunnelEligiblePort}.
 */
export function classifyLocalhostUrl(href: string): { port: number } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const defaultPort = DEFAULT_PORTS[url.protocol];
  if (defaultPort === undefined || !LOOPBACK_HOSTS.has(url.hostname)) return null;
  return { port: url.port ? Number(url.port) : defaultPort };
}

/**
 * Privileged ports stay unreachable: one authenticated call would otherwise
 * publish SSH or any system service on an unauthenticated public URL. The
 * daemon's own port is excluded because the daemon-self tunnel already covers
 * it, and the daemon route rejects both.
 */
export function isTunnelEligiblePort(port: number, daemonPort: number): boolean {
  return port >= 1024 && port <= 65535 && port !== daemonPort;
}

/**
 * Label prefix that scopes a `TunnelManager` entry to a forwarded port.
 * Mirrored in Rust by `PORT_TUNNEL_LABEL_PREFIX`
 * (`crates/mainframe-launch/src/port_tunnel_registry.rs`).
 */
export const PORT_TUNNEL_LABEL_PREFIX = 'port:';

export function portTunnelLabel(port: number): string {
  return `${PORT_TUNNEL_LABEL_PREFIX}${port}`;
}

/** Returns `null` for every label that is not a port tunnel's (`daemon`, `preview:*`). */
export function parsePortTunnelLabel(label: string): number | null {
  if (!label.startsWith(PORT_TUNNEL_LABEL_PREFIX)) return null;
  const rest = label.slice(PORT_TUNNEL_LABEL_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;
  const port = Number(rest);
  return port >= 1 && port <= 65535 ? port : null;
}

export interface PortTunnelStartRequest {
  port: number;
  chatId: string;
}

export interface PortTunnelStartResponse {
  url: string;
  port: number;
}

export interface PortTunnelInfo {
  port: number;
  url?: string;
  state: 'starting' | 'ready';
}

export interface PortTunnelsList {
  tunnels: PortTunnelInfo[];
  /**
   * The daemon's own HTTP port, which the client cannot infer: a remote daemon
   * is reached through a portless tunnel URL, so the client would otherwise
   * fall back to the *local* daemon's port and chip a link this route rejects.
   */
  daemonPort: number;
}
