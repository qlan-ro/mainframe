import { safeStorage } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { Logger } from 'pino';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';

export class SecureStorageUnavailable extends Error {
  constructor() {
    super('Electron safeStorage encryption is not available on this system');
    this.name = 'SecureStorageUnavailable';
  }
}

function dataDir(): string {
  return process.env['MAINFRAME_DATA_DIR'] ?? join(homedir(), '.mainframe');
}

function registryPath(): string {
  return join(dataDir(), 'remote-daemons.json');
}

function tokensPath(): string {
  return join(dataDir(), 'remote-daemon-tokens.json');
}

async function ensureDir(filePath: string): Promise<void> {
  const dir = join(filePath, '..');
  await mkdir(dir, { recursive: true });
}

export async function readRegistry(): Promise<DaemonMeta[]> {
  try {
    const raw = await readFile(registryPath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as DaemonMeta[];
  } catch {
    return [];
  }
}

export async function writeRegistry(metas: DaemonMeta[]): Promise<void> {
  const path = registryPath();
  await ensureDir(path);
  await writeFile(path, JSON.stringify(metas, null, 2), 'utf-8');
}

async function readTokenMap(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(tokensPath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeTokenMap(map: Record<string, string>): Promise<void> {
  const path = tokensPath();
  await ensureDir(path);
  await writeFile(path, JSON.stringify(map, null, 2), 'utf-8');
}

export async function setToken(id: string, token: string, log?: Logger): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    log?.warn({ id }, 'daemons-store: safeStorage unavailable, cannot store token');
    throw new SecureStorageUnavailable();
  }
  const encrypted = safeStorage.encryptString(token);
  const base64 = encrypted.toString('base64');
  const map = await readTokenMap();
  map[id] = base64;
  await writeTokenMap(map);
}

export async function getToken(id: string): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const map = await readTokenMap();
  const base64 = map[id];
  if (base64 === undefined) return null;
  const buf = Buffer.from(base64, 'base64');
  return safeStorage.decryptString(buf);
}

export async function deleteToken(id: string): Promise<void> {
  const map = await readTokenMap();
  delete map[id];
  await writeTokenMap(map);
}

export async function removeDaemon(id: string): Promise<void> {
  const [metas] = await Promise.all([readRegistry()]);
  const filtered = metas.filter((m) => m.id !== id);
  await Promise.all([writeRegistry(filtered), deleteToken(id)]);
}
