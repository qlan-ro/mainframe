/**
 * Synthetic replies for the streaming-markdown benchmark. Nothing here comes
 * from a real session: the text is generated so the long reply has the shape
 * of a large answer (headings, prose, lists, tables, fenced code, quotes,
 * links, images and footnotes) without any transcript content.
 */

const TS_BLOCK = [
  '```ts',
  'export function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {',
  '  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);',
  '  const out: Array<[number, number]> = [];',
  '  for (const [start, end] of sorted) {',
  '    const last = out.at(-1);',
  '    if (last && start <= last[1]) last[1] = Math.max(last[1], end);',
  '    else out.push([start, end]);',
  '  }',
  '  return out;',
  '}',
  '```',
];

const RUST_BLOCK = [
  '```rust',
  'pub fn checksum(bytes: &[u8]) -> u32 {',
  '    bytes.iter().fold(0u32, |acc, b| acc.rotate_left(5) ^ u32::from(*b))',
  '}',
  '```',
];

const SHELL_BLOCK = ['```bash', 'pnpm --filter example-package test -- --run', 'cargo test -p example-crate', '```'];

const PLAIN_BLOCK = ['```', 'plain fenced text with no language', '  indented second line', '```'];

function section(n: number): string[] {
  return [
    `## ${n}. Section about the widget pipeline`,
    '',
    `The **widget pipeline** stage ${n} reads the queue, groups entries by key and writes a summary. ` +
      'It keeps the *original order* within each group, so `stableSort` is enough here. ' +
      `See [the design note](https://example.com/notes/${n}) and \`src/pipeline/stage-${n}.ts\` for details.`,
    '',
    `- First, the reader drains up to ${n * 10} entries per tick.`,
    '- Then the grouper hashes each key:',
    '  - collisions fall back to a linear probe;',
    '  - empty keys are dropped with a warning.',
    '- Finally the writer flushes on a timer.',
    '',
    '1. Parse the input.',
    '2. Validate ~~every~~ each field.',
    '3. Emit the result.',
    '',
    '- [x] Covered by unit tests',
    '- [ ] Covered by the browser rig',
    '',
    '| Stage | Input | Output | Notes |',
    '| --- | --- | --- | --- |',
    `| read | queue | batch | up to ${n * 10} entries |`,
    '| group | batch | groups | keeps order within a group |',
    '| write | groups | summary | flushes every 500 ms |',
    '',
    ...(n % 2 === 0 ? TS_BLOCK : RUST_BLOCK),
    '',
    '> A note in a quote: the timer resets after each flush, so a busy queue never waits the full interval.',
    '',
    ...(n % 3 === 0 ? SHELL_BLOCK : PLAIN_BLOCK),
    '',
  ];
}

function longReply(footnote: boolean): string {
  const lines = [
    '# Widget pipeline review',
    '',
    `Here is the full walkthrough, section by section.${footnote ? '[^1]' : ''}`,
    '',
  ];
  for (let n = 1; n <= 9; n++) lines.push(...section(n));
  lines.push('---', '', 'That covers every stage.', '');
  if (footnote) lines.push('[^1]: A synthetic footnote for the benchmark.', '');
  return lines.join('\n');
}

/** 362 lines and 12 KB: the perf fixture. */
export const LONG_REPLY = longReply(false);
/** The same reply with one footnote, which keeps a reply in one block (see the README). */
export const LONG_REPLY_FOOTNOTE = longReply(true);

/** Every element once, for the before/after screenshots. */
export const VISUAL_REPLY = [
  '# Heading one',
  '## Heading two',
  '### Heading three',
  '#### Heading four',
  '',
  'A paragraph with **bold**, *italic*, ~~struck~~, `inline code`, a [web link](https://example.com/docs), ' +
    'a bare URL https://example.com/plain and a file link [stage.ts](src/pipeline/stage.ts).',
  'A footnote reference sits here.[^note]',
  '',
  '- Bullet one',
  '- Bullet two',
  '  - Nested bullet',
  '',
  '1. Ordered one',
  '2. Ordered two',
  '',
  '- [x] Done task',
  '- [ ] Open task',
  '',
  '| Name | Kind | Size |',
  '| --- | --- | ---: |',
  '| alpha | file | 12 KB |',
  '| beta | folder | 3 items |',
  '',
  ...TS_BLOCK,
  '',
  ...PLAIN_BLOCK,
  '',
  '> A quoted line of text.',
  '',
  '![Remote image](http://localhost:5199/benchmarks/streaming-markdown/sample.svg)',
  '',
  '---',
  '',
  'Last paragraph.',
  '',
  '[^note]: The footnote text.',
  '',
].join('\n');
