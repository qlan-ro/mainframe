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
