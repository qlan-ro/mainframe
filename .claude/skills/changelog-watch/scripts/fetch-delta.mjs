#!/usr/bin/env node
/**
 * Thin I/O shell over changelog-delta.mjs: fetches the upstream changelog or
 * release list, slices the delta since the last reviewed anchor, and writes
 * a triage report. The only file in this skill allowed to print or touch
 * the network or filesystem — everything else is a pure function.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  parseChangelogSections,
  sectionsSince,
  selectReleasesSince,
  renderDelta,
  nextStateFor,
} from './changelog-delta.mjs';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const statePath = path.join(skillDir, 'state.json');

function parseArgs(argv) {
  const args = { max: 40, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => argv[++i];
    if (flag === '--tool') args.tool = value();
    else if (flag === '--since') args.since = value();
    else if (flag === '--max') args.max = Number(value());
    else if (flag === '--out') args.out = value();
    else if (flag === '--commit-state') args.commitState = value();
    else if (flag === '--json') args.json = true;
    else throw new Error(`unknown flag: ${flag}`);
  }
  if (!args.tool) throw new Error('--tool <claude|codex> is required');
  return args;
}

// `gh api ... --paginate` on repos/openai/codex/releases returns every release
// ever tagged (945 releases, ~120MB as of 2026-07-25 — most of it alpha-tag
// noise going back to the repo's first commit). Node's execFile default
// (1MB) throws well before that; size the cap for today's payload plus room
// to grow rather than the plan's unstated assumption that it'd stay small.
const GH_MAX_BUFFER = 256 * 1024 * 1024;

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

async function fetchReleases(repo) {
  try {
    const { stdout } = await execFileAsync('gh', ['api', `repos/${repo}/releases`, '--paginate'], {
      maxBuffer: GH_MAX_BUFFER,
    });
    return JSON.parse(stdout);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`);
    if (!res.ok) throw new Error(`gh missing and fallback fetch failed: ${res.status}`);
    return res.json();
  }
}

async function buildDelta(toolState, since, max) {
  if (toolState.mode === 'changelog') {
    const sections = parseChangelogSections(await fetchChangelogText(toolState.repo, toolState.changelogPath));
    return { ...sectionsSince(sections, since, { max }), head: sections[0]?.version };
  }
  const releases = await fetchReleases(toolState.repo);
  const result = selectReleasesSince(releases, {
    lastTag: since,
    includePrerelease: toolState.includePrerelease,
    max,
  });
  const candidates = toolState.includePrerelease ? releases : releases.filter((r) => !r.prerelease);
  const newest = candidates.reduce(
    (best, r) => (!best || new Date(r.published_at) > new Date(best.published_at) ? r : best),
    null,
  );
  return { ...result, head: newest?.tag_name };
}

function defaultOutPath(tool) {
  const isoDate = new Date().toISOString().slice(0, 10);
  return path.join(skillDir, 'reports', `${isoDate}-${tool}-delta.md`);
}

async function writeReport(outPath, tool, entries) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${renderDelta(tool, entries)}\n`, 'utf8');
}

async function commitState(tool, version) {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const next = nextStateFor(state, tool, {
    version,
    at: new Date().toISOString().slice(0, 10),
  });
  await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function printResult(json, { tool, since, delta, outPath }) {
  const { head, count, reachedAnchor, truncated, nextAnchor } = delta;
  if (json) {
    console.log(
      JSON.stringify({ tool, anchor: since, head, count, reachedAnchor, truncated, nextAnchor, out: outPath }),
    );
    return;
  }
  if (count === 0) {
    console.log(`no changes: ${tool} is current at ${since}`);
    return;
  }
  console.log(`wrote ${count} ${count === 1 ? 'entry' : 'entries'} (${since} -> ${head}) to ${outPath}`);
  if (truncated) {
    console.log(`truncated: more entries remain upstream of ${nextAnchor}`);
    const cliPath = path.relative(process.cwd(), path.join(scriptDir, 'fetch-delta.mjs'));
    console.log(`continue with: node ${cliPath} --tool ${tool} --since ${nextAnchor} --max ${count}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const toolState = state.tools[args.tool];
  if (!toolState) throw new Error(`unknown tool: ${args.tool} (not in state.json)`);

  const since = args.since ?? toolState.lastReviewedVersion;
  const delta = await buildDelta(toolState, since, args.max);
  if (!delta.reachedAnchor) throw new Error(`unknown anchor: ${since}`);

  const outPath = args.out ?? defaultOutPath(args.tool);
  delta.count = delta.entries.length;
  if (delta.count > 0) await writeReport(outPath, args.tool, delta.entries);
  if (args.commitState) await commitState(args.tool, args.commitState);

  printResult(args.json, { tool: args.tool, since, delta, outPath });
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
