import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import type { DaemonEvent, LaunchConfiguration, LaunchProcessStatus } from '@mainframe/types';
import { createChildLogger } from '../logger.js';
import type { TunnelManager } from '../tunnel/tunnel-manager.js';

const log = createChildLogger('launch');

const PORT_POLL_MS = 1_000;
const PORT_TIMEOUT_MS = 60_000;

function expandEnvValues(env: Record<string, string>): Record<string, string> {
  const home = homedir();
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    result[k] = v.startsWith('~/') || v === '~' ? home + v.slice(1) : v;
  }
  return result;
}

/** Strip pnpm/npm vars leaked from the daemon's own pnpm run context. */
function cleanEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (k.startsWith('npm_') || k === 'PNPM_SCRIPT_SRC_DIR') continue;
    result[k] = v;
  }
  return result;
}

interface ManagedProcess {
  process: ChildProcess;
  status: LaunchProcessStatus;
}

export class LaunchManager {
  private processes = new Map<string, ManagedProcess>();

  constructor(
    private projectId: string,
    private projectPath: string,
    private onEvent: (event: DaemonEvent) => void,
    private tunnelManager?: TunnelManager,
  ) {}

  async start(config: LaunchConfiguration): Promise<void> {
    if (this.processes.has(config.name)) {
      log.warn({ name: config.name }, 'process already running, skipping start');
      return;
    }

    this.emit({ type: 'launch.status', projectId: this.projectId, name: config.name, status: 'starting' });

    const child = spawn(config.runtimeExecutable, config.runtimeArgs, {
      cwd: this.projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: {
        ...cleanEnv(),
        ...(config.port != null ? { PORT: String(config.port) } : {}),
        ...(config.env ? expandEnvValues(config.env) : {}),
      },
    });

    const managed: ManagedProcess = { process: child, status: 'starting' };
    this.processes.set(config.name, managed);

    const stderrTail: string[] = [];
    const MAX_STDERR_LINES = 20;

    child.stdout?.on('data', (chunk: Buffer) => {
      this.emit({
        type: 'launch.output',
        projectId: this.projectId,
        name: config.name,
        data: chunk.toString('utf-8'),
        stream: 'stdout',
      });
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      for (const line of text.split('\n')) {
        if (line.trim()) {
          stderrTail.push(line);
          if (stderrTail.length > MAX_STDERR_LINES) stderrTail.shift();
        }
      }
      this.emit({
        type: 'launch.output',
        projectId: this.projectId,
        name: config.name,
        data: text,
        stream: 'stderr',
      });
    });

    child.on('exit', (code) => {
      if (code !== 0 && stderrTail.length > 0) {
        log.warn({ name: config.name, pid: child.pid, code, stderr: stderrTail.join('\n') }, 'launch process failed');
      } else {
        log.info({ name: config.name, pid: child.pid, code }, 'launch process exited');
      }
      if (managed.status !== 'stopped') {
        managed.status = code === 0 ? 'stopped' : 'failed';
        this.emit({
          type: 'launch.status',
          projectId: this.projectId,
          name: config.name,
          status: managed.status,
        });
      }
      this.processes.delete(config.name);

      // Clean up tunnel when process exits unexpectedly
      if (this.tunnelManager) {
        this.tunnelManager.stop(`preview:${config.name}`);
      }
    });

    // Wait for spawn or error
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => {
        log.info(
          {
            name: config.name,
            pid: child.pid,
            cmd: `${config.runtimeExecutable} ${config.runtimeArgs.join(' ')}`,
            port: config.port,
          },
          'launch process spawned',
        );
        resolve();
      });
      child.once('error', (err) => {
        log.error({ err, name: config.name }, 'process error');
        managed.status = 'failed';
        this.processes.delete(config.name);
        this.emit({ type: 'launch.status', projectId: this.projectId, name: config.name, status: 'failed' });
        if (this.tunnelManager) {
          this.tunnelManager.stop(`preview:${config.name}`);
        }
        reject(err);
      });
    });

    // If a port is configured, wait until the server is actually listening before
    // emitting 'running'. This prevents clients from loading a URL too early.
    if (config.port != null) {
      log.info({ name: config.name, port: config.port }, 'waiting for port to become ready…');
      const timedOut = await this.waitForPort(config.port, managed);
      if (timedOut) {
        this.emit({ type: 'launch.port.timeout', projectId: this.projectId, name: config.name, port: config.port });
      }
    }

    if (managed.status === 'starting') {
      managed.status = 'running';
      this.emit({ type: 'launch.status', projectId: this.projectId, name: config.name, status: 'running' });
      log.info({ name: config.name, port: config.port }, 'launch process ready');
    }

    if (config.preview && config.port != null && this.tunnelManager) {
      const label = `preview:${config.name}`;
      this.tunnelManager.start(config.port, label).then(
        (url) => {
          this.emit({ type: 'launch.tunnel', projectId: this.projectId, name: config.name, url });
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          log.warn({ err, name: config.name }, 'tunnel failed to start');
          this.emit({ type: 'launch.tunnel.failed', projectId: this.projectId, name: config.name, error: message });
        },
      );
    }
  }

  async stop(name: string): Promise<void> {
    const managed = this.processes.get(name);
    if (!managed) return;
    managed.status = 'stopped';
    this.emit({ type: 'launch.status', projectId: this.projectId, name, status: 'stopped' });

    if (this.tunnelManager) {
      this.tunnelManager.stop(`preview:${name}`);
    }

    const child = managed.process;
    const pid = child.pid;

    // Kill the entire process group (pnpm/tsx spawn child trees)
    if (pid) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    } else {
      child.kill('SIGTERM');
    }
    log.info({ name, pid }, 'stopping launch process (SIGTERM)');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        log.warn({ name }, 'process did not exit after SIGTERM, sending SIGKILL');
        if (pid) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        } else {
          child.kill('SIGKILL');
        }
      }, 5_000);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    log.info({ name, pid }, 'launch process stopped');
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.processes.keys()).map((name) => this.stop(name)));
  }

  getStatus(name: string): LaunchProcessStatus {
    return this.processes.get(name)?.status ?? 'stopped';
  }

  getAllStatuses(): Record<string, LaunchProcessStatus> {
    const result: Record<string, LaunchProcessStatus> = {};
    for (const [name, managed] of this.processes) {
      result[name] = managed.status;
    }
    return result;
  }

  /** Poll localhost:port until the dev server responds or the process exits. Returns true if timed out. */
  private waitForPort(port: number, managed: ManagedProcess): Promise<boolean> {
    const start = Date.now();
    return new Promise<boolean>((resolve) => {
      const attempt = async () => {
        // Stop polling if the process died or was stopped
        if (managed.status === 'stopped' || managed.status === 'failed') {
          resolve(false);
          return;
        }
        if (Date.now() - start > PORT_TIMEOUT_MS) {
          log.warn({ port }, 'port readiness timeout, proceeding anyway');
          resolve(true);
          return;
        }
        try {
          const res = await fetch(`http://localhost:${port}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(3_000),
          });
          if (res.ok) {
            resolve(false);
            return;
          }
        } catch {
          // Not listening yet
        }
        setTimeout(attempt, PORT_POLL_MS);
      };
      attempt();
    });
  }

  private emit(event: DaemonEvent): void {
    this.onEvent(event);
  }
}
