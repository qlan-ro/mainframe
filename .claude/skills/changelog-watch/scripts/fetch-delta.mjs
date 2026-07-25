#!/usr/bin/env node
/**
 * Thin I/O shell over changelog-delta.mjs: fetches the upstream changelog or
 * release list, slices the delta since the last reviewed anchor, and writes
 * a triage report. The only file in the delta pipeline allowed to print or
 * touch the network or filesystem — everything else is a pure function.
 */
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  parseChangelogSections,
  sectionsSince,
  selectReleasesSince,
  renderDelta,
  nextStateFor,
  canAdvanceTo,
} from './changelog-delta.mjs';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const statePath = path.join(skillDir, 'state.json');

const VALUE_FLAGS = new Set(['--tool', '--since', '--max', '--out', '--commit-state']);

function takeValue(flag, raw) {
  if (raw === undefined) throw new Error(`${flag} expects a value`);
  // Without this, `--commit-state --json` consumed the next flag as its value
  // and wrote `"lastReviewedRef": "--json"` into the committed state file.
  if (raw.startsWith('--')) throw new Error(`${flag} expects a value, got the flag "${raw}"`);
  return raw;
}

function positiveInt(flag, raw) {
  if (!/^\d+$/.test(raw) || Number(raw) === 0) {
    throw new Error(`${flag} must be a positive integer, got "${raw}"`);
  }
  return Number(raw);
}

function parseArgs(argv) {
  const args = { max: 40, json: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--json') args.json = true;
    else if (flag === '--force') args.force = true;
    else if (!VALUE_FLAGS.has(flag)) throw new Error(`unknown flag: ${flag}`);
    else {
      const value = takeValue(flag, argv[++i]);
      if (flag === '--tool') args.tool = value;
      else if (flag === '--since') args.since = value;
      else if (flag === '--max') args.max = positiveInt(flag, value);
      else if (flag === '--out') args.out = value;
      else args.commitState = value;
    }
  }
  if (!args.tool) throw new Error('--tool <claude|codex> is required');
  if (!/^[a-zA-Z0-9_-]+$/.test(args.tool)) throw new Error(`--tool must match [a-zA-Z0-9_-]+, got "${args.tool}"`);
  return args;
}

const RELEASES_PER_PAGE = 100;
// 2000 releases deep. openai/codex tags several alphas a day, so this is
// roughly a year of history — far past any anchor a live state.json holds.
const MAX_RELEASE_PAGES = 20;
// One page of openai/codex releases is ~13MB of JSON; execFile's 1MB default
// truncates it into a parse error.
const GH_MAX_BUFFER = 64 * 1024 * 1024;

async function fetchChangelogText(repo, changelogPath) {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/${repo}/contents/${changelogPath}`, '--jq', '.content'],
      { maxBuffer: GH_MAX_BUFFER },
    );
    return Buffer.from(stdout.trim(), 'base64').toString('utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${changelogPath}`);
    if (!res.ok) throw new Error(`gh missing and fallback fetch failed: ${res.status}`);
    return res.text();
  }
}

async function fetchReleasePage(repo, page) {
  const query = `per_page=${RELEASES_PER_PAGE}&page=${page}`;
  try {
    const { stdout } = await execFileAsync('gh', ['api', `repos/${repo}/releases?${query}`], {
      maxBuffer: GH_MAX_BUFFER,
    });
    return JSON.parse(stdout);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?${query}`);
    if (!res.ok) throw new Error(`gh missing and fallback fetch failed: ${res.status}`);
    return res.json();
  }
}

// Stop at the page carrying the anchor: openai/codex has ~950 releases (120MB,
// 43s) and only the newest handful are ever unreviewed. `complete` records
// whether the walk saw the end of the list, so a missing anchor can be
// reported as "older than we fetched" rather than "gone from upstream".
async function fetchReleasesUntil(repo, anchor) {
  const releases = [];
  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    const batch = await fetchReleasePage(repo, page);
    releases.push(...batch);
    if (batch.length < RELEASES_PER_PAGE) return { releases, complete: true };
    if (batch.some((release) => release.tag_name === anchor)) return { releases, complete: false };
  }
  return { releases, complete: false };
}

async function buildDelta(toolState, since, max) {
  if (toolState.mode === 'changelog') {
    const sections = parseChangelogSections(await fetchChangelogText(toolState.repo, toolState.changelogPath));
    return { ...sectionsSince(sections, since, { max }), complete: true, fetched: sections.length };
  }
  const { releases, complete } = await fetchReleasesUntil(toolState.repo, since);
  const result = selectReleasesSince(releases, {
    lastTag: since,
    includePrerelease: toolState.includePrerelease,
    max,
  });
  return { ...result, complete, fetched: releases.length };
}

function anchorError(anchor, { complete, fetched }) {
  if (complete) {
    return `unknown anchor: ${anchor} — absent from the complete upstream list (history rewritten, or a typo)`;
  }
  return (
    `unknown anchor: ${anchor} — absent from the ${fetched} newest releases fetched, which stopped short of ` +
    `the full list; the anchor is older than this walk reaches`
  );
}

function defaultOutPath(tool, anchor) {
  const isoDate = new Date().toISOString().slice(0, 10);
  const slug = anchor.replace(/[^A-Za-z0-9._-]/g, '-');
  return path.join(skillDir, 'reports', `${isoDate}-${tool}-since-${slug}-delta.md`);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

// Multi-pass walks all land on the same day and tool; without this an
// unreviewed pass silently overwrites the one before it, and `reports/` is
// gitignored, so nothing recovers it.
async function writeReport(outPath, entries, force) {
  if (!force && (await fileExists(outPath))) {
    throw new Error(`refusing to overwrite ${outPath} — pass a different --out, or --force`);
  }
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${renderDelta(entries)}\n`, 'utf8');
}

// A state advance claims "everything up to this ref is triaged", so it must
// name an entry this run fetched and find that pass's delta still on disk.
// Otherwise `--commit-state <head>` walks the anchor over releases nobody read.
async function advanceState(tool, ref, { since, delta, outPath }) {
  if (!canAdvanceTo(ref, { anchor: since, entries: delta.entries })) {
    const newest = delta.entries[0]?.id ?? since;
    throw new Error(
      `--commit-state ${ref} is not in this delta (${since} -> ${newest}); ` +
        'state advances only over entries this run fetched',
    );
  }
  if (ref !== since && !(await fileExists(outPath))) {
    throw new Error(`refusing to advance state: no delta at ${outPath} — run the fetch pass first`);
  }
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const next = nextStateFor(state, tool, { ref, at: new Date().toISOString().slice(0, 10) });
  await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function printResult(json, { tool, since, delta, outPath, committed }) {
  const { head, count, reachedAnchor, truncated, nextAnchor } = delta;
  if (json) {
    console.log(
      JSON.stringify({
        tool,
        anchor: since,
        head,
        count,
        reachedAnchor,
        truncated,
        nextAnchor,
        // Nothing is written for an empty delta; naming a path that does not
        // exist would send a caller looking for a file.
        out: count > 0 ? outPath : null,
        committed: committed ?? null,
      }),
    );
    return;
  }
  if (committed) {
    console.log(`advanced ${tool} anchor: ${since} -> ${committed}`);
    return;
  }
  if (count === 0) {
    console.log(`no changes: ${tool} is current at ${since}`);
    return;
  }
  console.log(`wrote ${count} ${count === 1 ? 'entry' : 'entries'} (${since} -> ${head}) to ${outPath}`);
  if (truncated) {
    const cliPath = path.relative(process.cwd(), path.join(scriptDir, 'fetch-delta.mjs'));
    const nextOut = path.relative(process.cwd(), defaultOutPath(tool, nextAnchor));
    console.log(`truncated: more entries remain upstream of ${nextAnchor}`);
    console.log(
      `continue with: node ${cliPath} --tool ${tool} --since ${nextAnchor} --max ${count} --out ${nextOut}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const toolState = state.tools[args.tool];
  if (!toolState) throw new Error(`unknown tool: ${args.tool} (not in state.json)`);

  const since = args.since ?? toolState.lastReviewedRef;
  const delta = await buildDelta(toolState, since, args.max);
  if (!delta.reachedAnchor) throw new Error(anchorError(since, delta));

  const outPath = args.out ?? defaultOutPath(args.tool, since);
  delta.count = delta.entries.length;
  if (args.commitState) await advanceState(args.tool, args.commitState, { since, delta, outPath });
  else if (delta.count > 0) await writeReport(outPath, delta.entries, args.force);

  printResult(args.json, { tool: args.tool, since, delta, outPath, committed: args.commitState });
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
