#!/usr/bin/env node
/**
 * Diffs the named surfaces of two CLI builds by reading the JavaScript their
 * single-file executables embed. Catches what ships without a changelog
 * entry (claude.ai Projects support reached 2.1.318 with none).
 *
 * The binaries are only read, never executed. Each version comes from a local
 * install when `binary.localVersionsDir` holds it, otherwise from the
 * platform's npm package, downloaded into a temporary directory that is
 * removed after the scan.
 */
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { changeCount, diffSurfaces, renderBinaryDiff } from './surface-extract.mjs';
import { scanFile } from './surface-scan.mjs';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const repoRoot = path.resolve(skillDir, '..', '..', '..');
const statePath = path.join(skillDir, 'state.json');

const VALUE_FLAGS = new Set(['--tool', '--from', '--to', '--from-file', '--to-file', '--out']);
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

function takeValue(flag, raw) {
  if (raw === undefined) throw new Error(`${flag} expects a value`);
  if (raw.startsWith('--')) throw new Error(`${flag} expects a value, got the flag "${raw}"`);
  return raw;
}

function parseArgs(argv) {
  const args = { json: false, force: false };
  const keys = {
    '--tool': 'tool',
    '--from': 'from',
    '--to': 'to',
    '--from-file': 'fromFile',
    '--to-file': 'toFile',
    '--out': 'out',
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--json') args.json = true;
    else if (flag === '--force') args.force = true;
    else if (!VALUE_FLAGS.has(flag)) throw new Error(`unknown flag: ${flag}`);
    else args[keys[flag]] = takeValue(flag, argv[++i]);
  }
  if (!args.tool) throw new Error('--tool <claude> is required');
  if (!/^[a-zA-Z0-9_-]+$/.test(args.tool)) throw new Error(`--tool must match [a-zA-Z0-9_-]+, got "${args.tool}"`);
  for (const key of ['from', 'to']) {
    if (args[key] !== undefined && !VERSION.test(args[key])) {
      throw new Error(`--${key} must be a version such as 2.1.326, got "${args[key]}"`);
    }
  }
  return args;
}

function expandHome(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function packageName(binary) {
  return binary.npmPackage.replace('{platform}', `${process.platform}-${process.arch}`);
}

async function latestVersion(binary) {
  const { stdout } = await execFileAsync('npm', ['view', packageName(binary), 'version']);
  return stdout.trim();
}

async function largestFile(dir) {
  let best = null;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    const { size } = await stat(full);
    if (!best || size > best.size) best = { full, size };
  }
  if (!best) throw new Error(`no files in ${dir}`);
  return best.full;
}

/** Returns { file, cleanup } for a version: the local install, or a fresh npm download. */
async function resolveBinary(binary, version) {
  if (binary.localVersionsDir) {
    const local = path.join(expandHome(binary.localVersionsDir), version);
    if (await exists(local)) return { file: local, source: 'local install', cleanup: async () => {} };
  }
  const spec = `${packageName(binary)}@${version}`;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'changelog-watch-binary-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const { stdout } = await execFileAsync('npm', ['pack', spec, '--pack-destination', dir, '--json'], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const [{ filename }] = JSON.parse(stdout);
    const extractDir = path.join(dir, 'extract');
    await mkdir(extractDir);
    await execFileAsync('tar', ['-xzf', path.join(dir, path.basename(filename)), '-C', extractDir]);
    return { file: await largestFile(extractDir), source: `npm ${spec}`, cleanup };
  } catch (err) {
    await cleanup();
    throw new Error(`could not fetch ${spec}: ${err.message.split('\n')[0]}`);
  }
}

async function scanVersion(binary, version, overrideFile) {
  if (overrideFile) return { sets: await scanFile(overrideFile), source: overrideFile };
  const { file, source, cleanup } = await resolveBinary(binary, version);
  try {
    return { sets: await scanFile(file), source };
  } finally {
    await cleanup();
  }
}

function defaultOutPath(tool, from, to) {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(skillDir, 'reports', `${date}-${tool}-binary-${from}-to-${to}.md`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const toolState = state.tools[args.tool];
  if (!toolState) throw new Error(`unknown tool: ${args.tool} (not in state.json)`);
  const binary = toolState.binary;
  const needsBinary = !(args.fromFile && args.toFile);
  if (needsBinary && !binary?.npmPackage) {
    throw new Error(`${args.tool} has no binary.npmPackage in state.json; the binary diff covers bundled-JS CLIs only`);
  }

  const from = args.from ?? toolState.lastReviewedRef;
  const to = args.to ?? (args.toFile ? 'file' : await latestVersion(binary));
  if (from === to && !args.fromFile && !args.toFile) {
    console.log(
      args.json
        ? JSON.stringify({ tool: args.tool, from, to, changes: 0, out: null })
        : `no changes: ${args.tool} binary is already ${to}`,
    );
    return;
  }

  const outPath = args.out ?? defaultOutPath(args.tool, from, to);
  if (!args.force && (await exists(outPath))) {
    throw new Error(`refusing to overwrite ${outPath}; pass --force or a different --out`);
  }

  const before = await scanVersion(binary, from, args.fromFile);
  const after = await scanVersion(binary, to, args.toFile);
  const diff = diffSurfaces(before.sets, after.sets);
  const checklistPath = toolState.checklist ? path.join(repoRoot, toolState.checklist) : null;
  const checklistText = checklistPath && (await exists(checklistPath)) ? await readFile(checklistPath, 'utf8') : '';

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, renderBinaryDiff({ tool: args.tool, from, to, diff, checklistText }), 'utf8');

  const changes = changeCount(diff);
  if (args.json) {
    console.log(JSON.stringify({ tool: args.tool, from, to, changes, out: outPath }));
  } else {
    console.log(`scanned ${before.source} and ${after.source}`);
    console.log(`wrote ${changes} surface ${changes === 1 ? 'change' : 'changes'} (${from} -> ${to}) to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
