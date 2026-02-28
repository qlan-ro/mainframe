import { describe, it, expect } from 'vitest';
import { parseLaunchConfig, getPreviewUrl } from '../launch/launch-config.js';

const VALID_CONFIG = {
  version: '0.0.1',
  configurations: [
    { name: 'API', runtimeExecutable: 'node', runtimeArgs: ['server.js'], port: 4000, url: null },
    { name: 'UI', runtimeExecutable: 'pnpm', runtimeArgs: ['run', 'dev'], port: 3000, url: null, preview: true },
  ],
};

describe('parseLaunchConfig', () => {
  it('parses a valid config', () => {
    const result = parseLaunchConfig(VALID_CONFIG);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.configurations).toHaveLength(2);
  });

  it('rejects a config with no configurations', () => {
    const result = parseLaunchConfig({ version: '0.0.1', configurations: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a config with a shell-injection runtimeExecutable', () => {
    const result = parseLaunchConfig({
      ...VALID_CONFIG,
      configurations: [{ ...VALID_CONFIG.configurations[0]!, runtimeExecutable: 'node; rm -rf /' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects when more than one preview:true', () => {
    const result = parseLaunchConfig({
      ...VALID_CONFIG,
      configurations: [
        { ...VALID_CONFIG.configurations[0]!, preview: true },
        { ...VALID_CONFIG.configurations[1]!, preview: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a config with env vars', () => {
    const result = parseLaunchConfig({
      ...VALID_CONFIG,
      configurations: [{ ...VALID_CONFIG.configurations[0]!, env: { NODE_ENV: 'test', PORT: '4001' } }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects env with invalid key (shell operators)', () => {
    const result = parseLaunchConfig({
      ...VALID_CONFIG,
      configurations: [{ ...VALID_CONFIG.configurations[0]!, env: { 'bad-key': 'value' } }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts configs with missing optional fields (port, url, runtimeArgs)', () => {
    const result = parseLaunchConfig({
      version: '1',
      configurations: [
        { name: 'DB', runtimeExecutable: 'docker', runtimeArgs: ['compose', 'up'], port: 5433, env: {} },
        { name: 'API', runtimeExecutable: './gradlew', runtimeArgs: ['bootRun'], port: 8088 },
        { name: 'Web', runtimeExecutable: 'npm', runtimeArgs: ['start'], preview: true },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.configurations[0]!.url).toBeNull();
    expect(result.data.configurations[1]!.url).toBeNull();
    expect(result.data.configurations[2]!.port).toBeNull();
    expect(result.data.configurations[2]!.url).toBeNull();
  });

  it('accepts env keys with mixed case', () => {
    const result = parseLaunchConfig({
      ...VALID_CONFIG,
      configurations: [
        { ...VALID_CONFIG.configurations[0]!, env: { MAINFRAME_DATA_DIR: '~/.mainframe', nodeEnv: 'test' } },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('getPreviewUrl', () => {
  it('uses url field when present', () => {
    const config = {
      ...VALID_CONFIG,
      configurations: [
        {
          name: 'UI',
          runtimeExecutable: 'pnpm',
          runtimeArgs: [],
          port: 3000,
          url: 'http://myproxy.local',
          preview: true,
        },
      ],
    };
    expect(getPreviewUrl(config.configurations)).toBe('http://myproxy.local');
  });

  it('constructs localhost url from port', () => {
    expect(getPreviewUrl(VALID_CONFIG.configurations)).toBe('http://localhost:3000');
  });

  it('returns null when no preview config', () => {
    const configs = [{ name: 'API', runtimeExecutable: 'node', runtimeArgs: [], port: 4000, url: null }];
    expect(getPreviewUrl(configs)).toBeNull();
  });
});
