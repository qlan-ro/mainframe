import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { DAEMON_VERSION } from '../version.js';

const execFileAsync = promisify(execFile);

const REPO = 'qlan-ro/mainframe';

export interface GhAsset {
  name: string;
  browser_download_url: string;
}
export interface GhRelease {
  tag_name: string;
  prerelease: boolean;
  draft?: boolean;
  assets: GhAsset[];
}

export interface UpdateOptions {
  /** Specific tag to install (e.g. `v2.0.0-rc.1`). Overrides the latest lookup. */
  version?: string;
  /** Consider pre-releases when picking the newest release. */
  includePrerelease?: boolean;
  /** Install even if the target release is not newer than the running version. */
  force?: boolean;
}

/** Map the running platform to the release artifact filename it should install. */
export function standaloneArtifactName(platform: NodeJS.Platform, arch: string): string {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  const cpu = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
  if (!os || !cpu) {
    throw new Error(`Unsupported platform for self-update: ${platform}-${arch}`);
  }
  return `mainframe-daemon-${os}-${cpu}.tar.gz`;
}

/** Pick the release to install from a GitHub `/releases` list (newest first). */
export function pickRelease(releases: GhRelease[], opts: UpdateOptions): GhRelease {
  const published = releases.filter((r) => !r.draft);

  if (opts.version) {
    const norm = (t: string) => t.replace(/^v/, '');
    const found = published.find((r) => r.tag_name === opts.version || norm(r.tag_name) === norm(opts.version!));
    if (!found) throw new Error(`No release found for version ${opts.version}`);
    return found;
  }

  const candidates = published.filter((r) => opts.includePrerelease || !r.prerelease);
  const newest = candidates[0]; // GitHub returns releases newest-first
  if (!newest) {
    const hint = published.some((r) => r.prerelease)
      ? ' Only pre-releases exist — retry with `mainframe update --pre`.'
      : '';
    throw new Error(`No matching release found.${hint}`);
  }
  return newest;
}

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(version: string): SemVer {
  const [core, ...preParts] = version.replace(/^v/, '').split('-');
  const [major = 0, minor = 0, patch = 0] = core.split('.').map((n) => Number(n) || 0);
  const prerelease = preParts.join('-');
  return { major, minor, patch, prerelease: prerelease ? prerelease.split('.') : [] };
}

/** Compare two (optionally `v`-prefixed) semver strings: negative if `a` < `b`, 0 if equal, positive if `a` > `b`. */
export function compareSemver(a: string, b: string): number {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  if (va.patch !== vb.patch) return va.patch - vb.patch;
  // A release with no prerelease suffix outranks one with the same major.minor.patch that has one.
  if (va.prerelease.length === 0 && vb.prerelease.length > 0) return 1;
  if (va.prerelease.length > 0 && vb.prerelease.length === 0) return -1;
  const len = Math.max(va.prerelease.length, vb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const pa = va.prerelease[i];
    const pb = vb.prerelease[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    const na = Number(pa);
    const nb = Number(pb);
    const aIsNum = pa !== '' && !Number.isNaN(na);
    const bIsNum = pb !== '' && !Number.isNaN(nb);
    if (aIsNum && bIsNum) {
      if (na !== nb) return na - nb;
    } else if (aIsNum !== bIsNum) {
      return aIsNum ? -1 : 1; // numeric identifiers rank below alphanumeric ones (semver 11.4.4)
    } else if (pa !== pb) {
      return pa < pb ? -1 : 1;
    }
  }
  return 0;
}

/** Refuse to install a release that isn't newer than `currentVersion`, unless `force` is set. */
export function assertNotDowngrade(release: GhRelease, currentVersion: string, force: boolean): void {
  if (force) return;
  if (compareSemver(release.tag_name, currentVersion) > 0) return;
  throw new Error(
    `${release.tag_name} is not newer than the running version (v${currentVersion}). ` +
      'Refusing to downgrade — pass --force to override.',
  );
}

/** Resolve the download URL of `artifact` within a release, or throw. */
export function assetUrl(release: GhRelease, artifact: string): string {
  const asset = release.assets.find((a) => a.name === artifact);
  if (!asset) {
    throw new Error(`Release ${release.tag_name} does not include ${artifact}.`);
  }
  return asset.browser_download_url;
}

/** Parse `update` argv (everything after the subcommand) into options. */
export function parseUpdateArgs(argv: string[]): UpdateOptions & { help?: boolean; dir?: string } {
  const opts: UpdateOptions & { help?: boolean; dir?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pre' || arg === '--prerelease') opts.includePrerelease = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--version') opts.version = argv[++i];
    else if (arg === '--dir') opts.dir = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

/**
 * Locate the standalone install root (the dir holding `bin/` and `lib/`). The
 * wrapper exports MAINFRAME_STANDALONE_ROOT; fall back to deriving it from the
 * bundled node's path (`<root>/bin/node`).
 */
export function resolveInstallRoot(env = process.env, execPath = process.execPath): string {
  const fromEnv = env['MAINFRAME_STANDALONE_ROOT'];
  if (fromEnv && existsSync(join(fromEnv, 'lib', 'daemon.cjs'))) return fromEnv;

  const derived = dirname(dirname(execPath)); // <root>/bin/node → <root>
  if (existsSync(join(derived, 'lib', 'daemon.cjs'))) return derived;

  throw new Error(
    'Could not locate a standalone install to update. This looks like a dev or ' +
      'non-standalone build. Re-run the install script instead:\n' +
      '  curl -fsSL https://raw.githubusercontent.com/qlan-ro/mainframe/main/scripts/install.sh | bash',
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = { 'User-Agent': 'mainframe-updater' };
  if (process.env['GITHUB_TOKEN']) headers['Authorization'] = `Bearer ${process.env['GITHUB_TOKEN']}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function downloadTarball(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'mainframe-updater' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

export async function runUpdate(argv: string[] = process.argv.slice(3)): Promise<void> {
  let opts: UpdateOptions & { help?: boolean; dir?: string };
  try {
    opts = parseUpdateArgs(argv);
  } catch (err) {
    console.error(`  ${(err as Error).message}`);
    printUsage();
    process.exit(1);
  }
  if (opts.help) return printUsage();

  const root = opts.dir ?? resolveInstallRoot();
  const artifact = standaloneArtifactName(process.platform, process.arch);

  console.log('  Checking for updates…');
  const listUrl = opts.version
    ? `https://api.github.com/repos/${REPO}/releases/tags/${opts.version}`
    : `https://api.github.com/repos/${REPO}/releases?per_page=30`;
  const payload = await fetchJson<GhRelease | GhRelease[]>(listUrl);
  const release = pickRelease(Array.isArray(payload) ? payload : [payload], opts);
  assertNotDowngrade(release, DAEMON_VERSION, opts.force ?? false);
  const url = assetUrl(release, artifact);

  console.log(`  Installing ${release.tag_name} (${artifact}) → ${root}`);
  const tmp = await mkdtemp(join(tmpdir(), 'mainframe-update-'));
  try {
    const tarball = join(tmp, artifact);
    await downloadTarball(url, tarball);
    // Overwrite bin/ and lib/ in place; the running daemon keeps its loaded copy.
    await execFileAsync('tar', ['-xzf', tarball, '-C', root, '--strip-components=1']);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  console.log(`\n  Updated to ${release.tag_name}.`);
  console.log('  Restart the daemon to run it: `systemctl restart mainframe` (or restart the process).\n');
}

function printUsage(): void {
  console.log(
    [
      '',
      '  mainframe update — upgrade the standalone daemon in place',
      '',
      '  Usage: mainframe update [--pre] [--version <tag>] [--dir <path>] [--force]',
      '',
      '    --pre              include pre-releases when picking the newest',
      '    --version <tag>    install a specific release tag (e.g. v2.0.0-rc.1)',
      '    --dir <path>       install root to unpack over (default: auto-detected)',
      '    --force            allow installing a release that is not newer than the current one',
      '',
    ].join('\n'),
  );
}
