import { spawn, type ChildProcess } from 'node:child_process';
import type { WebSocket } from 'ws';
import type { LspRegistry } from './lsp-registry.js';
import { encodeJsonRpc } from './lsp-proxy.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('lsp-manager');

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const SHUTDOWN_REQUEST_TIMEOUT_MS = 3_000;
const SHUTDOWN_EXIT_TIMEOUT_MS = 2_000;

export interface LspServerHandle {
  process: ChildProcess;
  language: string;
  projectPath: string;
  client: WebSocket | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  cleanup: (() => void) | null;
}

export class LspManager {
  private handles = new Map<string, LspServerHandle>();
  private spawning = new Map<string, Promise<LspServerHandle>>();

  constructor(private _registry: LspRegistry) {}

  get registry(): LspRegistry {
    return this._registry;
  }

  private key(projectId: string, language: string): string {
    return `${projectId}:${language}`;
  }

  async getOrSpawn(projectId: string, language: string, projectPath: string): Promise<LspServerHandle> {
    const k = this.key(projectId, language);

    const existing = this.handles.get(k);
    if (existing) {
      this.cancelIdleTimer(existing);
      // Restart idle timer since no client may be connected
      if (!existing.client) {
        this.startIdleTimer(k, existing);
      }
      return existing;
    }

    const inflight = this.spawning.get(k);
    if (inflight) return inflight;

    const promise = this.doSpawn(k, language, projectPath);
    this.spawning.set(k, promise);
    try {
      return await promise;
    } finally {
      this.spawning.delete(k);
    }
  }

  private async doSpawn(key: string, language: string, projectPath: string): Promise<LspServerHandle> {
    const resolved = await this._registry.resolveCommand(language);
    if (!resolved) {
      throw new Error(`LSP server for '${language}' is not installed`);
    }

    log.info({ language, projectPath, command: resolved.command }, 'Spawning LSP server');

    const child = spawn(resolved.command, resolved.args, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const handle: LspServerHandle = {
      process: child,
      language,
      projectPath,
      client: null,
      idleTimer: null,
      cleanup: null,
    };

    child.on('exit', (code, signal) => {
      log.info({ language, projectPath, code, signal }, 'LSP server exited');
      this.removeHandle(key, handle);
    });

    child.on('error', (err) => {
      log.error({ err, language, projectPath }, 'LSP server process error');
      this.removeHandle(key, handle);
    });

    this.handles.set(key, handle);
    this.startIdleTimer(key, handle);

    return handle;
  }

  private removeHandle(key: string, handle: LspServerHandle): void {
    this.cancelIdleTimer(handle);
    handle.cleanup?.();
    if (handle.client && handle.client.readyState === 1) {
      handle.client.close(1001, 'LSP server exited');
    }
    handle.client = null;
    this.handles.delete(key);
  }

  startIdleTimer(key: string, handle: LspServerHandle): void {
    this.cancelIdleTimer(handle);
    handle.idleTimer = setTimeout(() => {
      log.info({ key }, 'LSP server idle timeout, shutting down');
      const [projectId, language] = key.split(':');
      this.shutdown(projectId!, language!).catch((err) => log.error({ err, key }, 'Error during idle shutdown'));
    }, IDLE_TIMEOUT_MS);
  }

  cancelIdleTimer(handle: LspServerHandle): void {
    if (handle.idleTimer) {
      clearTimeout(handle.idleTimer);
      handle.idleTimer = null;
    }
  }

  async shutdown(projectId: string, language: string): Promise<void> {
    const k = this.key(projectId, language);
    const handle = this.handles.get(k);
    if (!handle) return;

    this.cancelIdleTimer(handle);
    handle.cleanup?.();

    const proc = handle.process;
    if (proc.stdin?.writable) {
      try {
        const shutdownReq = JSON.stringify({ jsonrpc: '2.0', id: 'shutdown', method: 'shutdown', params: null });
        proc.stdin.write(encodeJsonRpc(shutdownReq));

        // Wait for shutdown response or timeout, then send exit notification
        const shutdownAck = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, SHUTDOWN_REQUEST_TIMEOUT_MS);
          proc.stdout?.once('data', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        await shutdownAck;

        const exitNotif = JSON.stringify({ jsonrpc: '2.0', method: 'exit' });
        proc.stdin.write(encodeJsonRpc(exitNotif));

        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, SHUTDOWN_EXIT_TIMEOUT_MS);
          proc.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      } catch (err) {
        log.warn({ err, language: handle.language }, 'Graceful shutdown sequence failed, force-killing');
      }
    }

    if (!proc.killed) {
      proc.kill('SIGTERM');
    }

    if (handle.client && handle.client.readyState === 1) {
      handle.client.close(1000, 'LSP server shut down');
    }
    handle.client = null;
    this.handles.delete(k);
  }

  async shutdownAll(): Promise<void> {
    const keys = [...this.handles.keys()];
    await Promise.all(
      keys.map((k) => {
        const [projectId, language] = k.split(':');
        return this.shutdown(projectId!, language!);
      }),
    );
  }

  getActiveLanguages(projectId: string): string[] {
    const result: string[] = [];
    for (const [key, handle] of this.handles) {
      if (key.startsWith(`${projectId}:`)) {
        result.push(handle.language);
      }
    }
    return result;
  }

  getHandle(projectId: string, language: string): LspServerHandle | undefined {
    return this.handles.get(this.key(projectId, language));
  }
}
