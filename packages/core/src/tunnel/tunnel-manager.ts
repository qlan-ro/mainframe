import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Resolver } from 'node:dns/promises';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('tunnel');

const TRYCLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const REGISTERED_RE = /Registered tunnel connection/;
const START_TIMEOUT_MS = 45_000;
const DNS_POLL_MS = 1_000;
const DNS_TIMEOUT_MS = 15_000;

interface ManagedTunnel {
  process: ChildProcess;
  url: string;
}

export class TunnelManager {
  private tunnels = new Map<string, ManagedTunnel>();

  static parseUrl(line: string): string | null {
    const match = TRYCLOUDFLARE_RE.exec(line);
    return match?.[0] ?? null;
  }

  start(port: number, label: string): Promise<string> {
    // Kill any existing tunnel for this label to prevent leaks
    this.stop(label);

    return new Promise<string>((resolve, reject) => {
      const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let done = false;
      let pendingUrl: string | null = null;
      let registered = false;

      const timeout = setTimeout(() => {
        if (!done) {
          done = true;
          child.kill('SIGTERM');
          reject(new Error(`Tunnel "${label}" timed out after ${START_TIMEOUT_MS}ms`));
        }
      }, START_TIMEOUT_MS);

      const tryFinish = () => {
        if (done || !pendingUrl || !registered) return;
        const url = pendingUrl;
        this.tunnels.set(label, { process: child, url });
        log.info({ label, url, port }, 'tunnel connected, waiting for DNS propagation…');

        // Verify DNS via Cloudflare (1.1.1.1) — does NOT touch local resolver
        this.waitForDns(url).then(
          () => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            log.info({ label, url }, 'tunnel ready (DNS verified)');
            resolve(url);
          },
          () => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            log.warn({ label, url }, 'tunnel DNS verification timed out, emitting anyway');
            resolve(url);
          },
        );
      };

      const scanStream = (stream: NodeJS.ReadableStream) => {
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        rl.on('line', (line) => {
          if (!pendingUrl) {
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
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              'cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
            ),
          );
        } else {
          reject(err);
        }
      });

      child.once('exit', (code) => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          reject(new Error(`Tunnel "${label}" process exited before ready (code ${code})`));
        } else {
          log.info({ label, code }, 'tunnel process exited');
          this.tunnels.delete(label);
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
  }

  stopAll(): void {
    for (const label of this.tunnels.keys()) {
      this.stop(label);
    }
  }

  getUrl(label: string): string | null {
    return this.tunnels.get(label)?.url ?? null;
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
