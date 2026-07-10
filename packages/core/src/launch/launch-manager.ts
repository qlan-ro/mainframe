import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { DaemonEvent, LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../logger.js';
import type { TunnelManager } from '../tunnel/tunnel-manager.js';
import type { ChildRegistryPort } from '../process/index.js';
import { LaunchProcessState, type LaunchOutputEntry } from './launch-process-state.js';

const log = createChildLogger('launch');

const PORT_POLL_MS = 1_000;
const PORT_TIMEOUT_MS = 60_000;

/**
 * Allowlisted env var names and prefixes passed to launched processes.
 * Everything else from the daemon (Electron, pnpm, internal Node vars) is dropped.
 * Users can add arbitrary vars via the launch config `env` block.
 */
const ENV_ALLOWLIST_EXACT = new Set([
  // OS / user identity
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'TERM_PROGRAM',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  'DISPLAY',
  'SSH_AUTH_SOCK',
  'COLORTERM',
  'EDITOR',
  'VISUAL',
  // Developer toolchains
  'JAVA_HOME',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
  'GOPATH',
  'GOROOT',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'PYENV_ROOT',
  'NVM_DIR',
  'VOLTA_HOME',
  'BUN_INSTALL',
  'DENO_DIR',
  'DOTNET_ROOT',
  'GRADLE_HOME',
  'MAVEN_HOME',
  'M2_HOME',
]);

const ENV_ALLOWLIST_PREFIXES = ['LANG', 'LC_'];

function isAllowedEnvVar(key: string): boolean {
  if (ENV_ALLOWLIST_EXACT.has(key)) return true;
  return ENV_ALLOWLIST_PREFIXES.some((p) => key.startsWith(p));
}

/** Build a minimal env for launched processes — only essential OS/user vars. */
function cleanEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (k === 'MAINFRAME_ORIG_PATH') continue;
    if (isAllowedEnvVar(k)) result[k] = v;
  }
  // The standalone launcher prepends its bundled-node bin dir to PATH so the
  // daemon itself can find its bundled Node/cloudflared. That prefix must never
  // reach user launch processes, or they resolve `node`/`npm` to Mainframe's
  // internal single-file Node (which ships without npm) instead of the user's
  // real toolchain. MAINFRAME_ORIG_PATH carries the pristine, pre-prefix PATH.
  const origPath = process.env.MAINFRAME_ORIG_PATH;
  if (origPath) {
    result.PATH = origPath;
  }
  return result;
}

interface ManagedProcess {
  process: ChildProcess;
  status: LaunchProcessStatus;
}

export class LaunchManager {
  private processes = new Map<string, ManagedProcess>();
  // Durable status/output tracking that outlives a `processes` entry being
  // deleted on exit — see LaunchProcessState's docstring for the races this
  // closes (a terminal status masked by the delete; a fast subprocess's
  // output missed by a late-attaching console pane).
  private state = new LaunchProcessState();

  constructor(
    private projectId: string,
    private projectPath: string,
    private onEvent: (event: DaemonEvent) => void,
    private tunnelManager?: TunnelManager,
    private childRegistry?: ChildRegistryPort,
  ) {}

  /**
   * Persist a spawned launch pid so a crashed daemon's next startup sweep can
   * reap its process group. Launch children are detached group leaders, so the
   * sweep needs the exact argv + cwd to reject a reused pid (see process/sweep).
   *
   * The cwd is recorded as a realpath: the sweep compares it against `lsof`,
   * which reports the resolved path, so a symlinked spawn cwd (every /tmp path
   * on macOS is /private/tmp) would otherwise fail the guard and leak the orphan.
   */
  private async recordSpawn(name: string, pid: number | undefined, executable: string, args: string[]): Promise<void> {
    if (pid == null || !this.childRegistry) return;
    const cwd = await realpath(this.projectPath).catch(() => this.projectPath);
    await this.childRegistry
      .add({
        pid,
        kind: 'launch',
        command: executable,
        args,
        cwd,
        group: true,
        label: `${this.projectId}:${name}`,
        spawnedAt: Date.now(),
      })
      .catch((err) => log.warn({ err, name, pid }, 'failed to record launch pid'));
  }

  private forgetSpawn(pid: number | undefined): void {
    if (pid == null || !this.childRegistry) return;
    this.childRegistry.remove(pid).catch((err) => log.warn({ err, pid }, 'failed to forget launch pid'));
  }

  async start(config: LaunchConfiguration): Promise<void> {
    if (this.processes.has(config.name)) {
      log.warn({ name: config.name }, 'process already running, skipping start');
      return;
    }

    this.state.reset(config.name);
    this.emit({
      type: 'launch.status',
      projectId: this.projectId,
      effectivePath: this.projectPath,
      name: config.name,
      status: 'starting',
    });

    // Resolve relative executables (./gradlew, ../bin/foo) against the project directory.
    // Node's spawn only searches PATH, not cwd, for the executable.
    const executable =
      config.runtimeExecutable.startsWith('./') || config.runtimeExecutable.startsWith('../')
        ? resolve(this.projectPath, config.runtimeExecutable)
        : config.runtimeExecutable;

    const child = spawn(executable, config.runtimeArgs, {
      cwd: this.projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: {
        ...cleanEnv(),
        ...(config.port != null ? { PORT: String(config.port) } : {}),
        ...(config.env ?? {}),
      },
    });

    const managed: ManagedProcess = { process: child, status: 'starting' };
    this.processes.set(config.name, managed);

    const stderrTail: string[] = [];
    const MAX_STDERR_LINES = 20;

    child.stdout?.on('data', (chunk: Buffer) => {
      const data = chunk.toString('utf-8');
      this.state.bufferOutput(config.name, 'stdout', data);
      this.emit({
        type: 'launch.output',
        projectId: this.projectId,
        effectivePath: this.projectPath,
        name: config.name,
        data,
        stream: 'stdout',
      });
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      this.state.bufferOutput(config.name, 'stderr', text);
      for (const line of text.split('\n')) {
        if (line.trim()) {
          stderrTail.push(line);
          if (stderrTail.length > MAX_STDERR_LINES) stderrTail.shift();
        }
      }
      this.emit({
        type: 'launch.output',
        projectId: this.projectId,
        effectivePath: this.projectPath,
        name: config.name,
        data: text,
        stream: 'stderr',
      });
    });

    child.on('exit', (code) => {
      this.forgetSpawn(child.pid);
      if (code !== 0 && stderrTail.length > 0) {
        log.warn({ name: config.name, pid: child.pid, code, stderr: stderrTail.join('\n') }, 'launch process failed');
      } else {
        log.info({ name: config.name, pid: child.pid, code }, 'launch process exited');
      }
      if (managed.status !== 'stopped') {
        managed.status = code === 0 ? 'stopped' : 'failed';
        this.state.setStatus(config.name, managed.status);
        this.emit({
          type: 'launch.status',
          projectId: this.projectId,
          effectivePath: this.projectPath,
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
      child.once('error', (err: NodeJS.ErrnoException) => {
        this.forgetSpawn(child.pid);
        log.warn(
          {
            name: config.name,
            code: err.code,
            syscall: err.syscall,
            path: err.path,
            message: err.message,
          },
          'process error',
        );
        managed.status = 'failed';
        this.state.setStatus(config.name, 'failed');
        this.processes.delete(config.name);
        this.emit({
          type: 'launch.status',
          projectId: this.projectId,
          effectivePath: this.projectPath,
          name: config.name,
          status: 'failed',
        });
        if (this.tunnelManager) {
          this.tunnelManager.stop(`preview:${config.name}`);
        }
        reject(err);
      });
    });

    // Record only after spawn is confirmed (pid valid) but BEFORE the long
    // port-readiness wait below — that wait is the window in which a daemon
    // crash would orphan this child, so its reap record must already be durable.
    await this.recordSpawn(config.name, child.pid, executable, config.runtimeArgs);

    // If a port is configured, wait until the server is actually listening before
    // emitting 'running'. This prevents clients from loading a URL too early.
    if (config.port != null) {
      log.info({ name: config.name, port: config.port }, 'waiting for port to become ready…');
      const timedOut = await this.waitForPort(config.port, managed);
      if (timedOut) {
        this.emit({
          type: 'launch.port.timeout',
          projectId: this.projectId,
          effectivePath: this.projectPath,
          name: config.name,
          port: config.port,
        });
      }
    }

    if (managed.status === 'starting') {
      managed.status = 'running';
      this.state.setStatus(config.name, 'running');
      this.emit({
        type: 'launch.status',
        projectId: this.projectId,
        effectivePath: this.projectPath,
        name: config.name,
        status: 'running',
      });
      log.info({ name: config.name, port: config.port }, 'launch process ready');
    }

    if (config.preview && config.port != null && this.tunnelManager) {
      const label = `preview:${config.name}`;
      this.tunnelManager.start(config.port, label).then(
        (url) => {
          this.emit({
            type: 'launch.tunnel',
            projectId: this.projectId,
            effectivePath: this.projectPath,
            name: config.name,
            url,
          });
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          log.warn({ err, name: config.name }, 'tunnel failed to start');
          this.emit({
            type: 'launch.tunnel.failed',
            projectId: this.projectId,
            effectivePath: this.projectPath,
            name: config.name,
            error: message,
          });
        },
      );
    }
  }

  async stop(name: string): Promise<void> {
    const managed = this.processes.get(name);
    if (!managed) return;
    managed.status = 'stopped';
    this.state.setStatus(name, 'stopped');
    this.emit({
      type: 'launch.status',
      projectId: this.projectId,
      effectivePath: this.projectPath,
      name,
      status: 'stopped',
    });

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
    return this.state.getStatus(name);
  }

  getAllStatuses(): Record<string, LaunchProcessStatus> {
    return this.state.getAllStatuses();
  }

  /** Buffered stdout/stderr for a config, oldest first. */
  getOutputBuffer(name: string): LaunchOutputEntry[] {
    return this.state.getOutputBuffer(name);
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
