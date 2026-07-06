/**
 * Collect the daemon's external/native runtime packages into a `node_modules/`
 * tree so a bundled, single-file `daemon.cjs` can `require()` them at runtime.
 *
 * The daemon is esbuilt with a handful of packages marked EXTERNAL (native addons
 * that can't be bundled + the LSP servers + ripgrep, which ship their own
 * binaries/files). Each stays a real `require()` that Node resolves from a
 * `node_modules` SIBLING of the requiring file. This walks each external plus its
 * transitive (optional) dependencies and deref-copies the real (pnpm-symlinked)
 * package dirs into one flat tree.
 *
 * Shared by the Tauri sidecar bundler (packages/app-tauri/scripts/bundle-daemon.mjs)
 * and the standalone daemon tarball (scripts/build-standalone.sh) so both ship a
 * complete, self-resolving daemon.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/** Resolve a package's root dir (the dir holding its package.json). */
function pkgDirOf(name, requireFn) {
  try {
    return dirname(requireFn.resolve(`${name}/package.json`));
  } catch {
    // Package blocks the ./package.json subpath via exports — resolve an entry
    // and walk up to the package.json whose "name" matches.
    let dir = dirname(requireFn.resolve(name));
    for (;;) {
      const pj = join(dir, 'package.json');
      if (existsSync(pj)) {
        try {
          if (JSON.parse(readFileSync(pj, 'utf8')).name === name) return dir;
        } catch {
          /* keep walking */
        }
      }
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`cannot locate package root for ${name}`);
      dir = parent;
    }
  }
}

/** Transitively gather a package + its (optional) deps into `found: name→dir`. */
function collect(name, requireFn, found, onWarn) {
  if (found.has(name)) return;
  let dir;
  try {
    dir = pkgDirOf(name, requireFn);
  } catch {
    onWarn(`skip unresolved dep: ${name}`);
    return;
  }
  found.set(name, dir);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return;
  }
  const next = createRequire(join(dir, 'package.json'));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
  for (const dep of Object.keys(deps)) collect(dep, next, found, onWarn);
}

/**
 * Populate `destNodeModules` with each external package + its transitive deps.
 *
 * @param {object}   opts
 * @param {string}   opts.requireBasePkgJson  Absolute path to a package.json whose
 *                                            directory anchors dependency resolution
 *                                            (typically packages/core/package.json).
 * @param {string[]} opts.externals           Package names to seed from (e.g.
 *                                            ['better-sqlite3', 'pyright']). Glob
 *                                            entries like '*.node' are ignored.
 * @param {string}   opts.destNodeModules      Absolute path to the node_modules dir to
 *                                            (re)create.
 * @param {(msg: string) => void} [opts.onWarn]  Warning sink for unresolved deps.
 * @returns {string[]} the resolved package names that were copied.
 */
export function collectDaemonDeps({ requireBasePkgJson, externals, destNodeModules, onWarn }) {
  const warn = onWarn ?? ((m) => console.warn(`[collect-daemon-deps] ${m}`));
  const requireBase = createRequire(requireBasePkgJson);

  const found = new Map();
  for (const name of externals.filter((e) => !e.includes('*'))) {
    collect(name, requireBase, found, warn);
  }

  rmSync(destNodeModules, { recursive: true, force: true });
  for (const [name, dir] of found) {
    const dest = join(destNodeModules, name); // scoped names (@vscode/ripgrep) nest correctly
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(dir, dest, { recursive: true, dereference: true });
  }
  return [...found.keys()];
}

// CLI: node collect-daemon-deps.mjs <requireBasePkgJson> <destNodeModules> <external...>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [requireBasePkgJson, destNodeModules, ...externals] = process.argv.slice(2);
  if (!requireBasePkgJson || !destNodeModules || externals.length === 0) {
    console.error(
      'Usage: node collect-daemon-deps.mjs <requireBasePkgJson> <destNodeModules> <external...>',
    );
    process.exit(1);
  }
  // createRequire needs an absolute path; CLI callers pass repo-relative ones.
  const copied = collectDaemonDeps({
    requireBasePkgJson: resolve(process.cwd(), requireBasePkgJson),
    destNodeModules: resolve(process.cwd(), destNodeModules),
    externals,
  });
  console.log(`[collect-daemon-deps] copied ${copied.length} packages → ${destNodeModules}`);
}
