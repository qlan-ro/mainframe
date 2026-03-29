import { describe, it, expect } from 'vitest';
import { expandVariables } from '../expand-variables.js';

describe('expandVariables', () => {
  it('replaces ${VAR} from env', () => {
    const result = expandVariables({ port: '${PORT}' }, { PORT: '3000' });
    expect(result).toEqual({ port: '3000' });
  });

  it('replaces ${VAR:-default} with env value when set', () => {
    const result = expandVariables({ port: '${PORT:-8080}' }, { PORT: '3000' });
    expect(result).toEqual({ port: '3000' });
  });

  it('uses default when env var is unset', () => {
    const result = expandVariables({ port: '${PORT:-8080}' }, {});
    expect(result).toEqual({ port: '8080' });
  });

  it('throws on unresolved variable without default', () => {
    expect(() => expandVariables({ port: '${PORT}' }, {})).toThrow("Unresolved variable 'PORT' in launch.json");
  });

  it('handles multiple expansions in one string', () => {
    const result = expandVariables({ url: 'http://${HOST:-localhost}:${PORT:-3000}/api' }, {});
    expect(result).toEqual({ url: 'http://localhost:3000/api' });
  });

  it('expands variables in arrays', () => {
    const result = expandVariables({ args: ['--port', '${PORT:-3000}'] }, {});
    expect(result).toEqual({ args: ['--port', '3000'] });
  });

  it('recurses into nested objects', () => {
    const result = expandVariables({ env: { DAEMON_PORT: '${PORT:-31416}' } }, {});
    expect(result).toEqual({ env: { DAEMON_PORT: '31416' } });
  });

  it('passes through numbers, booleans, and null unchanged', () => {
    const result = expandVariables({ port: 3000, preview: true, url: null }, {});
    expect(result).toEqual({ port: 3000, preview: true, url: null });
  });

  it('expands tilde in values', () => {
    const result = expandVariables({ dir: '~/data' }, {});
    expect((result as { dir: string }).dir).toMatch(/^\/.*\/data$/);
  });

  it('expands tilde combined with variable expansion', () => {
    const result = expandVariables({ dir: '~/${SUBDIR:-mainframe}' }, {});
    expect((result as { dir: string }).dir).toMatch(/^\/.*\/mainframe$/);
  });

  it('handles empty default', () => {
    const result = expandVariables({ val: '${EMPTY:-}' }, {});
    expect(result).toEqual({ val: '' });
  });

  it('leaves strings without patterns unchanged', () => {
    const result = expandVariables({ name: 'Core Daemon' }, {});
    expect(result).toEqual({ name: 'Core Daemon' });
  });
});
