import { describe, it, expect } from 'vitest';
import { parseLaunchConfig } from '../launch-config.js';

describe('parseLaunchConfig with variable expansion', () => {
  it('expands variables in env values', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: ['index.js'],
            port: null,
            env: { PORT: '${TEST_PORT:-9999}' },
          },
        ],
      },
      {},
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configurations[0]!.env).toEqual({ PORT: '9999' });
    }
  });

  it('coerces string port to number after expansion', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: [],
            port: '${PORT:-3000}',
          },
        ],
      },
      {},
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configurations[0]!.port).toBe(3000);
    }
  });

  it('fails on non-numeric port after expansion', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: [],
            port: '${PORT:-abc}',
          },
        ],
      },
      {},
    );
    expect(result.success).toBe(false);
  });

  it('resolves env vars from provided env', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: [],
            port: '${MY_PORT}',
          },
        ],
      },
      { MY_PORT: '4000' },
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configurations[0]!.port).toBe(4000);
    }
  });

  it('returns error for unresolved variable', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: [],
            port: '${UNSET_VAR}',
          },
        ],
      },
      {},
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Unresolved variable 'UNSET_VAR'");
    }
  });

  it('still accepts numeric port (backward compat)', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: [],
            port: 8080,
          },
        ],
      },
      {},
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configurations[0]!.port).toBe(8080);
    }
  });
});
