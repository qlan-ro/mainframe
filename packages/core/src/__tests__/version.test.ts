import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DAEMON_VERSION } from '../version.js';

describe('DAEMON_VERSION', () => {
  it('resolves to the core package.json version (dev/fallback path)', () => {
    // vitest does not apply the esbuild `__DAEMON_VERSION__` define, so this
    // exercises the package.json fallback used by `node dist/index.js` too.
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json');
    const expected = JSON.parse(readFileSync(pkgPath, 'utf8')).version as string;
    expect(DAEMON_VERSION).toBe(expected);
  });

  it('is a non-empty version string', () => {
    expect(DAEMON_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(DAEMON_VERSION).not.toBe('0.0.0-dev');
  });
});
