import { createRequire } from 'node:module';

/**
 * The daemon's own version.
 *
 * Bundled builds inline it: the esbuild `define` in the bundle-daemon scripts
 * replaces `__DAEMON_VERSION__` with the package version at build time (the
 * standalone tarball ships no package.json to read at runtime). In dev (tsx) and
 * unbundled `node dist/index.js` runs the token is absent, so we fall back to
 * reading the package.json next to this module.
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
