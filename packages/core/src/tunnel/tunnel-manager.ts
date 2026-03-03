import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('tunnel');

const TRYCLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const START_TIMEOUT_MS = 20_000;

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
    return new Promise<string>((resolve, reject) => {
      const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill('SIGTERM');
          reject(new Error(`Tunnel "${label}" timed out waiting for URL after ${START_TIMEOUT_MS}ms`));
        }
      }, START_TIMEOUT_MS);

      const tryResolve = (url: string) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        this.tunnels.set(label, { process: child, url });
        log.info({ label, url, port }, 'tunnel started');
        resolve(url);
      };

      const scanStream = (stream: NodeJS.ReadableStream) => {
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        rl.on('line', (line) => {
          const url = TunnelManager.parseUrl(line);
          if (url) tryResolve(url);
        });
      };

      if (child.stdout) scanStream(child.stdout);
      if (child.stderr) scanStream(child.stderr);

      child.once('error', (err: NodeJS.ErrnoException) => {
        if (resolved) return;
        resolved = true;
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
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Tunnel "${label}" process exited before URL was found (code ${code})`));
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
}
