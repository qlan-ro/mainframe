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

const DEFAULT_CONFIG: MainframeConfig = {
  port: 31415,
  dataDir: join(homedir(), '.mainframe'),
};

/** Env vars always override config.json values. */
function envOverrides(): Partial<MainframeConfig> {
  const overrides: Partial<MainframeConfig> = {};

  const rawPort = process.env['DAEMON_PORT'];
  if (rawPort !== undefined) {
    const parsed = Number(rawPort);
    if (Number.isFinite(parsed) && parsed > 0) overrides.port = parsed;
  }
  if (process.env['MAINFRAME_DATA_DIR']) {
    overrides.dataDir = process.env['MAINFRAME_DATA_DIR'];
  }
  if (process.env['TUNNEL'] === 'true') overrides.tunnel = true;
  if (process.env['TUNNEL_URL']) overrides.tunnelUrl = process.env['TUNNEL_URL'];
  if (process.env['TUNNEL_TOKEN']) overrides.tunnelToken = process.env['TUNNEL_TOKEN'];

  return overrides;
}

export function getDataDir(): string {
  const dir = process.env['MAINFRAME_DATA_DIR'] ?? DEFAULT_CONFIG.dataDir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getConfig(): MainframeConfig {
  const configPath = join(getDataDir(), 'config.json');

  let fileConfig: Partial<MainframeConfig> = {};
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(content);
    } catch {
      // fall through with defaults
    }
  }

  return { ...DEFAULT_CONFIG, ...fileConfig, ...envOverrides() };
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
