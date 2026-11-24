#!/usr/bin/env node
// Design artifact checks. See design/README.md.
//
//   node design/tools/check.mjs                 canvas checks only
//   node design/tools/check.mjs --base <ref>    also: every UI area whose code changed since <ref>
//                                               updates its canvas boards or its surface brief
//
// DESIGN_CHECK_SKIP=1 skips the area check (the PR carries the `design: none` label: no visible change).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CANVAS = 'design/canvas/project';

export function loadAreas(repo = REPO) {
  return JSON.parse(readFileSync(join(repo, 'design/areas.json'), 'utf8'));
}

/** Longest prefix wins, so `features/chat/composer/` beats `features/chat/`. */
function longest(candidates, value, keyOf) {
  let best = null;
  let bestLen = -1;
  for (const c of candidates) {
    for (const p of keyOf(c)) {
      if (value.startsWith(p) && p.length > bestLen) {
        best = c;
        bestLen = p.length;
      }
    }
  }
  return best;
}

export function areaForPath(cfg, file) {
  if (cfg.ignore.some((s) => file.includes(s))) return null;
  if (cfg.visual && !cfg.visual.some((ext) => file.endsWith(ext))) return null;
  return longest(cfg.areas, file, (a) => a.paths);
}

export function areaForBoard(cfg, board) {
  if (board.startsWith(cfg.proposalBoardPrefix)) return { id: 'proposals', page: cfg.proposalsPage, boards: [] };
  return longest(cfg.areas, board, (a) => a.boards);
}

/** Canvas index and files agree, and every board sits on its area's page. Returns a list of problems. */
export function checkCanvas(cfg, repo = REPO) {
  const problems = [];
  const dir = join(repo, CANVAS);
  const index = JSON.parse(readFileSync(join(dir, 'canvas.json'), 'utf8'));
  const files = new Set(readdirSync(dir).filter((f) => f.endsWith('.dc.html')));
  const boards = new Set(Object.keys(index.boards));
  const pages = new Set((index.pages || []).map((p) => p.id));

  for (const f of files) if (!boards.has(f)) problems.push(`${f} is in ${CANVAS} but not in canvas.json`);
  for (const b of boards) if (!files.has(b)) problems.push(`canvas.json lists ${b}, which has no file`);
  const order = new Set(index.order || []);
  if (order.size !== boards.size || [...boards].some((b) => !order.has(b))) {
    problems.push('canvas.json `order` must list every board exactly once');
  }

  const wanted = new Set([...cfg.areas.map((a) => a.page), cfg.proposalsPage]);
  for (const p of wanted) if (!pages.has(p)) problems.push(`page "${p}" (design/areas.json) is missing from canvas.json`);
  for (const p of pages) if (!wanted.has(p)) problems.push(`canvas page "${p}" belongs to no area in design/areas.json`);

  for (const [name, b] of Object.entries(index.boards)) {
    const stem = name.replace(/\.dc\.html$/, '');
    const area = areaForBoard(cfg, stem);
    if (!area) {
      problems.push(`${name} matches no area's board prefixes (design/areas.json)`);
      continue;
    }
    const page = b.page || (index.pages && index.pages[0] && index.pages[0].id);
    if (page !== area.page) problems.push(`${name} is on page "${page}" but belongs on "${area.page}"`);
  }
  for (const [id, n] of Object.entries(index.notes || {})) {
    if (n.page && !pages.has(n.page)) problems.push(`note "${id}" is on unknown page "${n.page}"`);
  }
  for (const a of cfg.areas) {
    if (a.brief && !existsSync(join(repo, a.brief))) problems.push(`area "${a.id}" names brief ${a.brief}, which does not exist`);
  }
  return problems;
}

const LOCAL = JSON.parse(readFileSync(join(REPO, 'design/canvas/lib/local-paths.json'), 'utf8'));
const ENCODED = new RegExp(LOCAL.encoded, 'g');
const BASE64 = new RegExp(LOCAL.base64, 'g');
const WRAP = new RegExp(LOCAL.wrap, 'g');
const LOCAL_PATH = new RegExp(`(?:${LOCAL.paths.join('|')})${LOCAL.end}`, 'g');

const decoded = (_, byHex, entityHex, entity, octal, slash) => {
  if (byHex || entityHex) return String.fromCharCode(parseInt(byHex || entityHex, 16));
  if (entity || octal) return String.fromCharCode(entity ? Number(entity) : parseInt(octal, 8));
  return slash ? '/' : '\\';
};

/** What a base64 run says. Dropping the NULs reads UTF-16 as well. */
const unbase64 = (run) => Buffer.from(run, 'base64').toString('latin1').replaceAll('\0', '');

/** Home and temp paths of a machine in `text`, escaped and base64 ones included. `lib/boards.py` holds new boards to the same rule. */
export function localPaths(text) {
  const runs = new Set([text, text.replace(WRAP, '')].flatMap((t) => t.match(BASE64) ?? []));
  const texts = [text, ...[...runs].map(unbase64)];
  return [...new Set(texts.flatMap((t) => t.replace(ENCODED, decoded).match(LOCAL_PATH) ?? []))].sort();
}

/** What is published or describes it: boards, index, design system, spec, prototype, briefs and the two guides. */
const PUBLISHED = [CANVAS, 'design/redesign', 'packages/ui/.impeccable', 'DESIGN.md', 'design/README.md'];

const filesIn = (path) =>
  statSync(path).isFile()
    ? [path]
    : readdirSync(path, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name));

/** The published design files name no machine's paths. */
export function checkLocalPaths(repo = REPO) {
  const problems = [];
  for (const file of PUBLISHED.flatMap((path) => filesIn(join(repo, path)))) {
    if (!/\.(?:html|json|css|js|md|svg)$/.test(file)) continue;
    const found = localPaths(readFileSync(file, 'utf8'));
    if (found.length) problems.push(`${relative(repo, file)} holds local paths: ${found.slice(0, 5).join(', ')}`);
  }
  return problems;
}

/**
 * Areas whose code changed without any of their design files changing.
 * `changed` is a list of { status, path } (git --name-status, renames off): any status counts for code, but a
 * deleted board or brief does not count as updating the design.
 */
export function uncoveredAreas(cfg, entries) {
  const norm = entries.map((e) => (typeof e === 'string' ? { status: 'M', path: e } : e));
  const changed = norm.map((e) => e.path);
  const kept = norm.filter((e) => e.status !== 'D').map((e) => e.path);
  const touched = new Map();
  for (const f of changed) {
    const a = areaForPath(cfg, f);
    if (a) touched.set(a.id, [...(touched.get(a.id) || []), f]);
  }
  const designed = new Set();
  for (const f of kept) {
    if (f.startsWith(`${CANVAS}/`) && f.endsWith('.dc.html')) {
      const stem = f.slice(CANVAS.length + 1).replace(/\.dc\.html$/, '');
      const a = areaForBoard(cfg, stem);
      if (a && a.id !== 'proposals') designed.add(a.id);
    }
    for (const a of cfg.areas) if (a.brief && f === a.brief) designed.add(a.id);
  }
  return [...touched].filter(([id]) => !designed.has(id)).map(([id, files]) => ({ area: cfg.areas.find((a) => a.id === id), files }));
}

function changedSince(base) {
  // --no-renames: a moved file shows as a delete plus an add, so moving UI out of an area still counts for it.
  const out = execFileSync('git', ['diff', '--name-status', '--no-renames', `${base}...HEAD`], { cwd: REPO, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split('\t');
      return { status: status[0], path };
    });
}

function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

function main() {
  const cfg = loadAreas();
  let failed = false;

  const problems = [...checkCanvas(cfg), ...checkLocalPaths()];
  if (problems.length) {
    failed = true;
    console.error(`Design canvas: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    summary(['### Design canvas', ...problems.map((p) => `- ${p}`)]);
  } else {
    console.log('Design canvas: index, files and pages agree, and no file names a local path.');
  }

  const i = process.argv.indexOf('--base');
  if (i !== -1 && !process.argv[i + 1]) {
    console.error('--base needs a git ref, e.g. --base origin/main');
    process.exit(2);
  }
  if (i !== -1) {
    if (process.env.DESIGN_CHECK_SKIP === '1') {
      console.log('Design coverage: skipped (`design: none` label).');
      summary(['### Design coverage', 'Skipped: the PR is labelled `design: none`.']);
    } else {
      const missing = uncoveredAreas(cfg, changedSince(process.argv[i + 1]));
      if (missing.length) {
        failed = true;
        const lines = ['### Design coverage', 'UI code changed in these areas without their design files:', ''];
        for (const { area, files } of missing) {
          const want = [`a board on the "${area.name}" page (${area.boards.map((b) => `\`${b}*\``).join(', ')})`];
          if (area.brief) want.push(`or \`${area.brief}\``);
          lines.push(`- **${area.name}**: update ${want.join(' ')}. Changed: ${files.slice(0, 5).map((f) => `\`${f}\``).join(', ')}${files.length > 5 ? ', …' : ''}`);
        }
        lines.push('', 'No visible change? Add the `design: none` label to the PR.');
        console.error(lines.join('\n'));
        summary(lines);
      } else {
        console.log('Design coverage: every UI area that changed updates its design files.');
      }
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
