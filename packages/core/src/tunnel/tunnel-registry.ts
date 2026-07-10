import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('tunnel-registry');

export interface TunnelRegistryEntry {
  pid: number;
  label: string;
  /** Absolute path of the cloudflared binary spawned — used to reap by exact identity. */
  binPath: string;
  spawnedAt: number;
}

export interface TunnelRegistryPort {
  add(entry: TunnelRegistryEntry): Promise<void>;
  remove(pid: number): Promise<void>;
  list(): Promise<TunnelRegistryEntry[]>;
  clear(): Promise<void>;
}

/** Inert registry for callers (and tests) that don't persist tunnel pids. */
export class NoopTunnelRegistry implements TunnelRegistryPort {
  async add(_entry: TunnelRegistryEntry): Promise<void> {}
  async remove(_pid: number): Promise<void> {}
  async list(): Promise<TunnelRegistryEntry[]> {
    return [];
  }
  async clear(): Promise<void> {}
}

function isEntry(value: unknown): value is TunnelRegistryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e['pid'] === 'number' &&
    Number.isFinite(e['pid']) &&
    typeof e['label'] === 'string' &&
    typeof e['binPath'] === 'string' &&
    typeof e['spawnedAt'] === 'number'
  );
}

/**
 * Pidfile-backed registry of live cloudflared children, written at spawn and
 * pruned on stop. It survives daemon crashes so the next startup sweep can reap
 * children this daemon leaked. Writes are serialized (a mutating tail promise)
 * and atomic (temp file + rename) to avoid interleaving concurrent tunnel spawns.
 */
export class FileTunnelRegistry implements TunnelRegistryPort {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async list(): Promise<TunnelRegistryEntry[]> {
    return this.enqueue(() => this.read());
  }

  add(entry: TunnelRegistryEntry): Promise<void> {
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

  private async read(): Promise<TunnelRegistryEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      log.warn({ err, file: this.file }, 'tunnel registry read failed, treating as empty');
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isEntry);
    } catch (err) {
      log.warn({ err, file: this.file }, 'tunnel registry is corrupt, treating as empty');
      return [];
    }
  }

  private async write(entries: TunnelRegistryEntry[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(entries), 'utf-8');
    await rename(tmp, this.file);
  }
}
