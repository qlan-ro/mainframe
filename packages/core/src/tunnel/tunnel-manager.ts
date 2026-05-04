import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Resolver } from 'node:dns/promises';
import { createChildLogger } from '../logger.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

const log = createChildLogger('tunnel');

type BroadcastFn = (event: DaemonEvent) => void;

const TRYCLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const REGISTERED_RE = /Registered tunnel connection/;
const START_TIMEOUT_MS = 45_000;
const DNS_POLL_MS = 1_000;
// Cloudflare's first-time DNS propagation for trycloudflare.com URLs routinely
// takes 20–30 seconds. 15s was too short and made the UI flap to "unreachable"
// for tunnels that became reachable a few seconds later.
const DNS_TIMEOUT_MS = 45_000;

export interface TunnelStartOptions {
  token?: string;
  url?: string;
}

interface ManagedTunnel {
  process: ChildProcess;
  url: string;
  ready: boolean;
}

const VERIFY_TIMEOUT_MS = 5_000;
const VERIFY_CACHE_TTL_MS = 30_000;

interface VerifyResult {
  reachable: boolean;
  checkedAt: number;
}

export class TunnelManager {
  private tunnels = new Map<string, ManagedTunnel>();
  private verifiedAt = new Map<string, VerifyResult>();
  private broadcast: BroadcastFn;

  constructor(broadcast?: BroadcastFn) {
    this.broadcast = broadcast ?? (() => {});
  }

  static parseUrl(line: string): string | null {
    const match = TRYCLOUDFLARE_RE.exec(line);
    return match?.[0] ?? null;
  }

  start(port: number, label: string, options?: TunnelStartOptions): Promise<string> {
    // Kill any existing tunnel for this label to prevent leaks
    this.stop(label);

    const isNamed = !!options?.token;

    this.broadcast({ type: 'tunnel:status', state: 'starting' });

    return new Promise<string>((resolve, reject) => {
      const args = isNamed
        ? ['tunnel', 'run', '--token', options.token!]
        : ['tunnel', '--url', `http://localhost:${port}`];

      const child = spawn('cloudflared', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let done = false;
      let pendingUrl: string | null = isNamed ? (options.url ?? null) : null;
      let registered = false;

      const timeout = setTimeout(() => {
        if (!done) {
          done = true;
          child.kill('SIGTERM');
          const msg = `Tunnel "${label}" timed out after ${START_TIMEOUT_MS}ms`;
          this.broadcast({ type: 'tunnel:status', state: 'error', error: msg });
          reject(new Error(msg));
        }
      }, START_TIMEOUT_MS);

      const tryFinish = () => {
        if (done || !pendingUrl || !registered) return;
        const url = pendingUrl;
        const tunnel: ManagedTunnel = { process: child, url, ready: false };
        this.tunnels.set(label, tunnel);
        log.info({ label, url, port }, 'tunnel connected, waiting for DNS propagation…');
        this.broadcast({ type: 'tunnel:status', state: 'ready', url, dnsVerified: false });

        this.waitForDns(url).then(
          () => {
            if (done) return;
            done = true;
            tunnel.ready = true;
            clearTimeout(timeout);
            log.info({ label, url }, 'tunnel ready (DNS verified)');
            this.broadcast({ type: 'tunnel:status', state: 'dns_verified', url, dnsVerified: true });
            resolve(url);
          },
          () => {
            if (done) return;
            done = true;
            tunnel.ready = true;
            clearTimeout(timeout);
            log.warn({ label, url }, 'tunnel DNS verification timed out, emitting anyway');
            this.broadcast({ type: 'tunnel:status', state: 'dns_verified', url, dnsVerified: false });
            resolve(url);
          },
        );
      };

      const scanStream = (stream: NodeJS.ReadableStream) => {
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        rl.on('line', (line) => {
          if (!isNamed && !pendingUrl) {
            const url = TunnelManager.parseUrl(line);
            if (url) {
              pendingUrl = url;
              log.debug({ label, url }, 'tunnel URL received, waiting for connection registration…');
              tryFinish();
            }
          }
          if (!registered && REGISTERED_RE.test(line)) {
            registered = true;
            log.debug({ label }, 'tunnel connection registered');
            tryFinish();
          }
        });
      };

      if (child.stdout) scanStream(child.stdout);
      if (child.stderr) scanStream(child.stderr);

      child.once('error', (err: NodeJS.ErrnoException) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        const message =
          err.code === 'ENOENT'
            ? 'cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
            : (err.message ?? String(err));
        this.broadcast({ type: 'tunnel:status', state: 'error', error: message });
        reject(new Error(message));
      });

      child.once('exit', (code) => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          const msg = `Tunnel "${label}" process exited before ready (code ${code})`;
          this.broadcast({ type: 'tunnel:status', state: 'error', error: msg });
          reject(new Error(msg));
        } else {
          log.info({ label, code }, 'tunnel process exited');
          this.tunnels.delete(label);
          this.broadcast({ type: 'tunnel:status', state: 'stopped' });
        }
      });
    });
  }

  stop(label: string): void {
    const tunnel = this.tunnels.get(label);
    if (!tunnel) return;
    tunnel.process.kill('SIGTERM');
    this.tunnels.delete(label);
    log.info({ label }, 'tunnel stopped');
    this.broadcast({ type: 'tunnel:status', state: 'stopped' });
  }

  stopAll(): void {
    for (const label of this.tunnels.keys()) {
      this.stop(label);
    }
  }

  getUrl(label: string): string | null {
    return this.tunnels.get(label)?.url ?? null;
  }

  async verify(label: string): Promise<boolean> {
    const cached = this.verifiedAt.get(label);
    if (cached && Date.now() - cached.checkedAt < VERIFY_CACHE_TTL_MS) {
      log.debug({ label, reachable: cached.reachable }, 'verify cache hit');
      return cached.reachable;
    }

    const tunnel = this.tunnels.get(label);
    if (!tunnel) return false;
    if (!tunnel.ready) return false;
    const url = tunnel.url;

    try {
      const res = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (!res.ok) {
        log.debug({ label, status: res.status }, 'verify failed: non-200');
        this.verifiedAt.set(label, { reachable: false, checkedAt: Date.now() });
        return false;
      }
      const body = (await res.json()) as { status?: string };
      const reachable = body.status === 'ok';
      log.debug({ label, reachable }, 'verify result');
      this.verifiedAt.set(label, { reachable, checkedAt: Date.now() });
      return reachable;
    } catch (err) {
      log.debug({ label, err }, 'verify failed: network error');
      return false;
    }
  }

  /** Poll Cloudflare DNS (1.1.1.1) until the tunnel hostname resolves. */
  private waitForDns(url: string): Promise<void> {
    const hostname = new URL(url).hostname;
    const resolver = new Resolver();
    resolver.setServers(['1.1.1.1', '1.0.0.1']);

    const start = Date.now();
    return new Promise<void>((resolve, reject) => {
      const attempt = async () => {
        if (Date.now() - start > DNS_TIMEOUT_MS) {
          reject(new Error('DNS verification timeout'));
          return;
        }
        try {
          await resolver.resolve4(hostname);
          resolve();
        } catch {
          setTimeout(attempt, DNS_POLL_MS);
        }
      };
      attempt();
    });
  }
}
