import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('child-registry');

export type ManagedChildKind = 'tunnel' | 'launch';

/**
 * One persistent record of a daemon-spawned child process. It carries enough
 * identity for a startup sweep to reap the child SAFELY after a daemon crash —
 * the exact argv and cwd so the sweep can reject a PID reused by an unrelated
 * process (see `process/sweep.ts`).
 */
export interface ManagedChildEntry {
  pid: number;
  kind: ManagedChildKind;
  /** argv[0] — an absolute executable path when known. A bare name still records but weakens the sweep guard. */
  command: string;
  /** argv after the executable, exactly as spawned. */
  args: string[];
  /** Working directory the child was spawned in, or null when not tracked (tunnels). */
  cwd: string | null;
  /** Reap the child's whole process group (`kill(-pid)`) on sweep — set for detached launch trees. */
  group: boolean;
  /** Human-facing label/scope for logs (tunnel label, or `${projectId}:${name}`). */
  label: string;
  spawnedAt: number;
}

export interface ChildRegistryPort {
  add(entry: ManagedChildEntry): Promise<void>;
  remove(pid: number): Promise<void>;
  list(): Promise<ManagedChildEntry[]>;
  listByKind(kind: ManagedChildKind): Promise<ManagedChildEntry[]>;
  clear(): Promise<void>;
}

/** Inert registry for callers (and tests) that don't persist child pids. */
export class NoopChildRegistry implements ChildRegistryPort {
  async add(_entry: ManagedChildEntry): Promise<void> {}
  async remove(_pid: number): Promise<void> {}
  async list(): Promise<ManagedChildEntry[]> {
    return [];
  }
  async listByKind(_kind: ManagedChildKind): Promise<ManagedChildEntry[]> {
    return [];
  }
  async clear(): Promise<void> {}
}

function isEntry(value: unknown): value is ManagedChildEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e['pid'] === 'number' &&
    Number.isFinite(e['pid']) &&
    (e['kind'] === 'tunnel' || e['kind'] === 'launch') &&
    typeof e['command'] === 'string' &&
    Array.isArray(e['args']) &&
    e['args'].every((a) => typeof a === 'string') &&
    (e['cwd'] === null || typeof e['cwd'] === 'string') &&
    typeof e['group'] === 'boolean' &&
    typeof e['label'] === 'string' &&
    typeof e['spawnedAt'] === 'number'
  );
}

/**
 * Pidfile-backed registry of live daemon-spawned children (tunnels + launch
 * configs), written at spawn and pruned on stop. It survives daemon crashes so
 * the next startup sweep can reap children this daemon leaked. Writes are
 * serialized (a mutating tail promise) and atomic (temp file + rename) so
 * concurrent spawns across the tunnel and launch managers never interleave.
 *
 * Records that fail validation (a corrupt file, or a stale pre-generalization
 * cloudflared entry) are dropped on read rather than crashing the daemon.
 */
export class FileChildRegistry implements ChildRegistryPort {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async list(): Promise<ManagedChildEntry[]> {
    return this.enqueue(() => this.read());
  }

  async listByKind(kind: ManagedChildKind): Promise<ManagedChildEntry[]> {
    const entries = await this.list();
    return entries.filter((e) => e.kind === kind);
  }

  add(entry: ManagedChildEntry): Promise<void> {
    return this.enqueue(async () => {
      const entries = await this.read();
      const next = entries.filter((e) => e.pid !== entry.pid);
      next.push(entry);
      await this.write(next);
    });
  }

  remove(pid: number): Promise<void> {
    return this.enqueue(async () => {
      const entries = await this.read();
      await this.write(entries.filter((e) => e.pid !== pid));
    });
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.write([]));
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.tail.then(op, op);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async read(): Promise<ManagedChildEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      log.warn({ err, file: this.file }, 'child registry read failed, treating as empty');
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isEntry);
    } catch (err) {
      log.warn({ err, file: this.file }, 'child registry is corrupt, treating as empty');
      return [];
    }
  }

  private async write(entries: ManagedChildEntry[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(entries), 'utf-8');
    await rename(tmp, this.file);
  }
}
