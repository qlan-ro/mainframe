import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import type { DaemonEvent, LaunchConfiguration, LaunchProcessStatus } from '@mainframe/types';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('launch');

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
      env: {
        ...cleanEnv(),
        ...(config.port != null ? { PORT: String(config.port) } : {}),
        ...(config.env ? expandEnvValues(config.env) : {}),
      },
    });

    const managed: ManagedProcess = { process: child, status: 'starting' };
    this.processes.set(config.name, managed);

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
      this.emit({
        type: 'launch.output',
        projectId: this.projectId,
        name: config.name,
        data: chunk.toString('utf-8'),
        stream: 'stderr',
      });
    });

    child.on('exit', (code) => {
      log.info({ name: config.name, code }, 'process exited');
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
    });

    // Wait for spawn or error so callers can rely on getStatus() returning 'running'
    // immediately after awaiting start().
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => {
        managed.status = 'running';
        this.emit({ type: 'launch.status', projectId: this.projectId, name: config.name, status: 'running' });
        log.info({ name: config.name, pid: child.pid }, 'process started');
        resolve();
      });
      child.once('error', (err) => {
        log.error({ err, name: config.name }, 'process error');
        managed.status = 'failed';
        this.processes.delete(config.name);
        this.emit({ type: 'launch.status', projectId: this.projectId, name: config.name, status: 'failed' });
        reject(err);
      });
    });
  }

  stop(name: string): void {
    const managed = this.processes.get(name);
    if (!managed) return;
    managed.status = 'stopped';
    this.emit({ type: 'launch.status', projectId: this.projectId, name, status: 'stopped' });
    managed.process.kill('SIGTERM');
    this.processes.delete(name);
    log.info({ name }, 'process stopped');
  }

  stopAll(): void {
    for (const name of Array.from(this.processes.keys())) {
      this.stop(name);
    }
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

  private emit(event: DaemonEvent): void {
    this.onEvent(event);
  }
}
