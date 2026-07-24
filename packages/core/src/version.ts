import { createRequire } from 'node:module';

/**
 * The daemon's own version.
 *
 * The Rust daemon replaced this package's bundled build in the shipped
 * release path, so nothing defines `__DAEMON_VERSION__` anymore — this
 * package now only runs from source (dev via tsx, or the test harness'
 * `node dist/index.js`), and always falls back to reading the package.json
 * next to this module.
 */
declare const __DAEMON_VERSION__: string | undefined;

function resolveVersion(): string {
  if (typeof __DAEMON_VERSION__ === 'string' && __DAEMON_VERSION__) return __DAEMON_VERSION__;
  try {
    const require = createRequire(import.meta.url);
    return (require('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0-dev';
  }
}

export const DAEMON_VERSION = resolveVersion();
