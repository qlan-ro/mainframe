// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const chat = (file: string) => read(`../../features/chat/${file}`);

it('uses the prototype inks in both themes', () => {
  const css = chat('transcript.css');
  expect(css.match(/--mf-tr-ok: (#[a-f0-9]+);/g)).toEqual(['--mf-tr-ok: #1d7a46;', '--mf-tr-ok: #4cc38a;']);
  expect(css.match(/--mf-tr-del: (#[a-f0-9]+);/g)).toEqual(['--mf-tr-del: #c0392b;', '--mf-tr-del: #ff7b6e;']);
});

it('matches the frame, work header, and marker geometry', () => {
  const header = chat('messages/turn/WorkHeader.tsx');
  expect(header.match(/rounded-\[7px\]/g)).toHaveLength(2);
  const table = chat('parts/markdown-table.tsx');
  expect(table).toContain('mf-tr-table');
  expect(table).toContain('text-sm/5');
  expect(table.match(/px-3 py-\[7px\]/g)).toHaveLength(2);
  expect(chat('tools/markers/MarkerPill.tsx')).toMatch(/h-6\.5 .*rounded-\[13px\].*px-\[11px\] mf-tr-marker-label/);
});

it('records the prototype markdown choices in T1b', () => {
  const decisions = read('../../../../../design/redesign/DECISIONS.md');
  const t1b = decisions.split('\n').find((line) => line.startsWith('| T1b |'));
  expect(t1b).toContain('List markers, upright quotes, unstriped tables and code language labels as written');
});
