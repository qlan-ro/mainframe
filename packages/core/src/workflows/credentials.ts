import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import type { Credentials } from './connectors/types.js';

/**
 * Plaintext JSON at a given path with 0600 perms.
 * The interface is the contract — an OS-keychain implementation can replace this
 * without touching callers. Secrets never enter template scope or step I/O.
 * Sync I/O is acceptable: only touched at startup and on rare credential writes.
 */
export class FileCredentialStore {
  private cache: Record<string, Credentials> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  get(label: string): Credentials | null {
    return this.load()[label] ?? null;
  }

  set(label: string, creds: Credentials): void {
    this.load()[label] = creds;
    this.persist();
  }

  delete(label: string): void {
    const store = this.load();
    delete store[label];
    this.persist();
  }

  labels(): string[] {
    return Object.keys(this.load());
  }

  private load(): Record<string, Credentials> {
    if (this.cache) return this.cache;
    if (!existsSync(this.filePath)) {
      this.cache = {};
      return this.cache;
    }
    try {
      this.cache = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, Credentials>;
    } catch (err) {
      this.logger.error(
        { err: String(err), filePath: this.filePath },
        'credential store unreadable; treating as empty',
      );
      this.cache = {};
    }
    return this.cache;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.load(), null, 2), { mode: 0o600 });
    chmodSync(this.filePath, 0o600);
  }
}
