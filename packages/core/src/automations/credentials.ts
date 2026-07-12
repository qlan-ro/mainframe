// packages/core/src/automations/credentials.ts
//
// Verbatim port of v1 workflows/credentials.ts (Task 14) onto the v2
// Credentials type, at <dataDir>/automation-credentials.json.
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import type { Credentials } from './actions/types.js';

/**
 * Plaintext JSON at a given path with 0600 perms.
 * The interface is the contract — an OS-keychain implementation can replace this
 * without touching callers. Secrets never enter template scope or step I/O.
 * Read once, synchronously, here in the constructor — the one documented
 * exception to "no sync I/O in the daemon": it runs once per process, at
 * daemon boot, never inside a request handler. Every write after that goes
 * through fs/promises so a credential PUT/DELETE never blocks the event
 * loop; reads serve straight from the in-memory cache the constructor
 * populated, so `get`/`labels` stay synchronous without touching disk again.
 */
export class FileCredentialStore {
  private readonly cache: Record<string, Credentials>;

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {
    this.cache = this.loadSync();
  }

  get(label: string): Credentials | null {
    return this.cache[label] ?? null;
  }

  async set(label: string, creds: Credentials): Promise<void> {
    this.cache[label] = creds;
    await this.persist();
  }

  async delete(label: string): Promise<void> {
    delete this.cache[label];
    await this.persist();
  }

  labels(): string[] {
    return Object.keys(this.cache);
  }

  private loadSync(): Record<string, Credentials> {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, Credentials>;
    } catch (err) {
      this.logger.error(
        { err: String(err), filePath: this.filePath },
        'credential store unreadable; treating as empty',
      );
      return {};
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.cache, null, 2), { mode: 0o600 });
    await chmod(this.filePath, 0o600);
  }
}
