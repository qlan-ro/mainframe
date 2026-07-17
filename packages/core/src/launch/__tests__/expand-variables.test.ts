import { describe, it, expect } from 'vitest';
import { expandVariables } from '../expand-variables.js';

describe('expandVariables', () => {
  it.each([
    ['replaces ${VAR} from env', { port: '${PORT}' }, { PORT: '3000' }, { port: '3000' }],
    ['replaces ${VAR:-default} with env value when set', { port: '${PORT:-8080}' }, { PORT: '3000' }, { port: '3000' }],
    ['uses default when env var is unset', { port: '${PORT:-8080}' }, {}, { port: '8080' }],
    [
      'handles multiple expansions in one string',
      { url: 'http://${HOST:-localhost}:${PORT:-3000}/api' },
      {},
      { url: 'http://localhost:3000/api' },
    ],
    [
      'passes through numbers, booleans, and null unchanged',
      { port: 3000, preview: true, url: null },
      {},
      { port: 3000, preview: true, url: null },
    ],
    ['handles empty default', { val: '${EMPTY:-}' }, {}, { val: '' }],
    ['leaves strings without patterns unchanged', { name: 'Core Daemon' }, {}, { name: 'Core Daemon' }],
  ])('%s', (_label, input, env, expected) => {
    expect(expandVariables(input, env)).toEqual(expected);
  });

  it.each([
    ['expands variables in arrays', { args: ['--port', '${PORT:-3000}'] }, {}, { args: ['--port', '3000'] }],
    ['recurses into nested objects', { env: { DAEMON_PORT: '${PORT:-31416}' } }, {}, { env: { DAEMON_PORT: '31416' } }],
  ])('%s', (_label, input, env, expected) => {
    expect(expandVariables(input, env)).toEqual(expected);
  });

  it.each([
    ['expands tilde in values', { dir: '~/data' }, /^\/.*\/data$/],
    ['expands tilde combined with variable expansion', { dir: '~/${SUBDIR:-mainframe}' }, /^\/.*\/mainframe$/],
  ] as const)('%s', (_label, input, pattern) => {
    const result = expandVariables(input, {});
    expect((result as { dir: string }).dir).toMatch(pattern);
  });

  it('throws on unresolved variable without default', () => {
    expect(() => expandVariables({ port: '${PORT}' }, {})).toThrow("Unresolved variable 'PORT' in launch.json");
  });
});
