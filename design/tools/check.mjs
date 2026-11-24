#!/usr/bin/env node
// Design artifact checks. See design/README.md.
//
//   node design/tools/check.mjs                 canvas checks only
//   node design/tools/check.mjs --base <ref>    also: every UI area whose code changed since <ref>
//                                               updates its canvas boards or its surface brief
//
// DESIGN_CHECK_SKIP=1 skips the area check (the PR carries the `design: none` label: no visible change).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
    if ((b.page || index.pages[0].id) !== area.page) {
      problems.push(`${name} is on page "${b.page}" but belongs on "${area.page}"`);
    }
  }
  for (const [id, n] of Object.entries(index.notes || {})) {
    if (n.page && !pages.has(n.page)) problems.push(`note "${id}" is on unknown page "${n.page}"`);
  }
  for (const a of cfg.areas) {
    if (a.brief && !existsSync(join(repo, a.brief))) problems.push(`area "${a.id}" names brief ${a.brief}, which does not exist`);
  }
  return problems;
}

/** Areas whose code changed without any of their design files changing. */
export function uncoveredAreas(cfg, changed) {
  const touched = new Map();
  for (const f of changed) {
    const a = areaForPath(cfg, f);
    if (a) touched.set(a.id, [...(touched.get(a.id) || []), f]);
  }
  const designed = new Set();
  for (const f of changed) {
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
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: REPO, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

function main() {
  const cfg = loadAreas();
  let failed = false;

  const problems = checkCanvas(cfg);
  if (problems.length) {
    failed = true;
    console.error(`Design canvas: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    summary(['### Design canvas', ...problems.map((p) => `- ${p}`)]);
  } else {
    console.log('Design canvas: index, files and pages agree.');
  }

  const i = process.argv.indexOf('--base');
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
