import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export interface MainframeConfig {
  port: number;
  dataDir: string;
  tunnel?: boolean;
  tunnelUrl?: string;
  tunnelToken?: string;
  authSecret?: string;
}

const rawPort = process.env['PORT'];
const parsedPort = rawPort !== undefined ? Number(rawPort) : NaN;
const DEFAULT_CONFIG: MainframeConfig = {
  port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 31415,
  dataDir: process.env['MAINFRAME_DATA_DIR'] ?? join(homedir(), '.mainframe'),
};

export function getDataDir(): string {
  const dir = DEFAULT_CONFIG.dataDir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getConfig(): MainframeConfig {
  const configPath = join(getDataDir(), 'config.json');

  let merged = DEFAULT_CONFIG;
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      merged = { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } catch {
      // fall through with defaults
    }
  }

  if (process.env['TUNNEL'] === 'true') {
    merged.tunnel = true;
  }
  if (process.env['TUNNEL_URL']) {
    merged.tunnelUrl = process.env['TUNNEL_URL'];
  }
  if (process.env['TUNNEL_TOKEN']) {
    merged.tunnelToken = process.env['TUNNEL_TOKEN'];
  }

  return merged;
}

export function saveConfig(config: Partial<MainframeConfig>): void {
  const configPath = join(getDataDir(), 'config.json');
  const current = getConfig();
  const merged = { ...current, ...config };
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
}

function getAuthSecret(): string | null {
  if (process.env['AUTH_TOKEN_SECRET']) {
    return process.env['AUTH_TOKEN_SECRET'];
  }
  const config = getConfig();
  return config.authSecret ?? null;
}

export function ensureAuthSecret(): string {
  const existing = getAuthSecret();
  if (existing) return existing;

  const secret = randomBytes(32).toString('hex');
  saveConfig({ authSecret: secret });
  return secret;
}
