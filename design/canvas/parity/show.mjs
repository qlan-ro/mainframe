// Prints the rows of one area, merged over themes and sizes.
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const by = new Map();
for (const r of rows) {
  const k = [r.state, r.el, r.part, r.prop, r.proto, r.app].join('|');
  by.set(k, [...(by.get(k) ?? []), `${r.view[0]}${r.theme[0]}`]);
}
let last = '';
for (const [k, where] of by) {
  const [state, el, part, prop, p, a] = k.split('|');
  const head = `${state} / ${el}`;
  if (head !== last) console.log(`\n${head}`);
  last = head;
  console.log(`  ${part} · ${prop}: ${p} → ${a}  [${where.length === 6 ? 'all' : where.join(' ')}]`);
}
