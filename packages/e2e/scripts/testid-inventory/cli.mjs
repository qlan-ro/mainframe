import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './analyze.mjs';
import { renderGapReport, renderUnused } from './render.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_SRC_DIR = path.resolve(MODULE_DIR, '../../../ui/src');
const SPEC_DIRS = ['tests-tauri', 'helpers', 'fixtures'].map((dir) => path.resolve(MODULE_DIR, '../..', dir));
const UNUSED_PATH = path.resolve(MODULE_DIR, '../../UNUSED-TESTIDS.md');
const GAP_REPORT_PATH = path.resolve(MODULE_DIR, '../../COVERAGE-GAP-REPORT.md');

const GENERATED_DATE_RE = /_Generated (\d{4}-\d{2}-\d{2})/;

function isExcludedSourcePath(relativePath) {
  return relativePath.split(path.sep).includes('__tests__') || /\.test\.tsx?$/.test(relativePath);
}

function isExcludedSpecPath(relativePath) {
  return relativePath.split(path.sep)[0] === 'recordings';
}

async function collectFiles(rootDir, extensions, isExcluded) {
  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);
      if (isExcluded(relativePath)) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

async function readFiles(paths) {
  return Promise.all(paths.map(async (filePath) => ({ path: filePath, text: await readFile(filePath, 'utf8') })));
}

// A `* data-testid="…"` line inside a JSDoc comment reads as a real definition
// to extract.mjs's regex scan; blanking comment lines before analysis keeps
// prose like TaskColumn.tsx's usage note from minting a bogus static entry.
function stripCommentLines(text) {
  return text
    .split('\n')
    .map((line) => (/^\s*(?:\*|\/\/)/.test(line) ? '' : line))
    .join('\n');
}

async function loadReport() {
  const sourcePaths = await collectFiles(UI_SRC_DIR, ['.ts', '.tsx'], isExcludedSourcePath);
  const specPathLists = await Promise.all(
    SPEC_DIRS.map((dir) => collectFiles(dir, ['.ts'], isExcludedSpecPath)),
  );
  const rawSourceFiles = await readFiles(sourcePaths);
  const sourceFiles = rawSourceFiles.map(({ path, text }) => ({ path, text: stripCommentLines(text) }));
  const specFiles = await readFiles(specPathLists.flat());
  return analyze({ sourceFiles, specFiles });
}

async function existingGeneratedDate(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    const match = GENERATED_DATE_RE.exec(text);
    return { exists: true, date: match?.[1] ?? null };
  } catch {
    return { exists: false, date: null };
  }
}

function todayISO() {
  // Local wall-clock date, not UTC: toISOString() would stamp yesterday for
  // any run east of UTC after 21:00 local time.
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function resolveDate(filePath, flags) {
  if (flags.date) return flags.date;
  if (flags.today) return todayISO();

  const existing = await existingGeneratedDate(filePath);
  if (!existing.exists) return todayISO();
  if (existing.date) return existing.date;

  process.stderr.write(`warning: no _Generated date in ${filePath}, stamping today\n`);
  return todayISO();
}

function parseFlags(argv) {
  const flags = { check: false, today: false, date: null };
  for (const arg of argv) {
    if (arg === '--check') flags.check = true;
    else if (arg === '--today') flags.today = true;
    else if (arg.startsWith('--date=')) flags.date = arg.slice('--date='.length);
  }
  return flags;
}

function firstDifferingLine(expected, actual) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < length; i += 1) {
    if (expectedLines[i] !== actualLines[i]) return i + 1;
  }
  return null;
}

async function checkOutput(filePath, rendered) {
  let onDisk;
  try {
    onDisk = await readFile(filePath, 'utf8');
  } catch {
    process.stderr.write(`${filePath}: missing\n`);
    return false;
  }
  if (onDisk === rendered) return true;
  const line = firstDifferingLine(onDisk, rendered);
  process.stderr.write(`${filePath}: differs at line ${line}\n`);
  return false;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const report = await loadReport();

  const unusedDate = await resolveDate(UNUSED_PATH, flags);
  const gapReportDate = await resolveDate(GAP_REPORT_PATH, flags);
  const renderedUnused = renderUnused(report, unusedDate);
  const renderedGapReport = renderGapReport(report, gapReportDate);

  if (flags.check) {
    const unusedOk = await checkOutput(UNUSED_PATH, renderedUnused);
    const gapReportOk = await checkOutput(GAP_REPORT_PATH, renderedGapReport);
    if (!unusedOk || !gapReportOk) process.exitCode = 1;
    return;
  }

  await writeFile(UNUSED_PATH, renderedUnused);
  await writeFile(GAP_REPORT_PATH, renderedGapReport);
}

main();
