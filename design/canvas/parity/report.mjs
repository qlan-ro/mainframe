import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify } from './classes.mjs';

const [directory, baseline] = process.argv.slice(2);
if (!directory) {
  console.error('Usage: node design/canvas/parity/report.mjs <output directory> [baseline directory]');
  process.exit(2);
}

const files = readdirSync(directory)
  .filter((name) => name.endsWith('.counts.json'))
  .sort();
if (!files.length) throw new Error('No measurement results found');
const baselineFiles = new Set(baseline ? readdirSync(baseline) : []);
const read = (dir, name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const cell = (value) =>
  String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
const classes = ['SPEC', 'DATA', 'PROTO', 'APP', 'OPEN'];
const summaries = [];
const tables = [];

for (const file of files) {
  const area = file.slice(0, -'.counts.json'.length);
  const name = `${area}.json`;
  const { states, elements, checks, problems = [] } = read(directory, file);
  const rows = read(directory, name);
  const counts = Object.fromEntries(classes.map((cls) => [cls, 0]));
  const results = rows.map((row) => {
    const { cls, why } = classify(row);
    counts[cls]++;
    return [row.state, row.view, row.theme, row.el, row.part, row.prop, row.proto, row.app, cls, why];
  });
  const remaining = new Set(rows.map((row) => JSON.stringify(row)));
  const gone = baselineFiles.has(name)
    ? read(baseline, name).filter((row) => !remaining.has(JSON.stringify(row))).length
    : '—';
  summaries.push([area, states, elements, checks, problems.length, gone, ...classes.map((cls) => counts[cls])]);
  tables.push(
    `## ${area}\n\n${table(['State', 'View', 'Theme', 'Element', 'Part', 'Property', 'Prototype', 'App', 'Class', 'Reason'], results)}`,
  );
  for (const problem of problems) console.error(`${area}: ${problem}`);
  if (counts.OPEN || problems.length) process.exitCode = 1;
}

function table(headers, rows) {
  const line = (values) => `| ${values.map(cell).join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

console.log(table(['Area', 'States', 'Elements', 'Checks', 'Problems', 'Baseline rows absent', ...classes], summaries));
console.log('\n' + tables.join('\n\n'));
