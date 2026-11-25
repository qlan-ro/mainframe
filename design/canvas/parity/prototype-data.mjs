import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../redesign/prototype/index.html', import.meta.url), 'utf8');
const start = source.indexOf('const $=(s,r=document)');
const end = source.indexOf(' s12:{', start);
if (start < 0 || end < 0) throw new Error('Prototype data declarations moved');
const { TPL, TURNS, PCOL } = runInNewContext(
  source.slice(start, end) + '\n};({ TPL, TURNS, PCOL })',
  {},
  { timeout: 1000 },
);

function markdown(node) {
  if (node.nodeType === 3) return node.textContent;
  const children = () => [...node.childNodes].map(markdown).join('');
  switch (node.nodeName) {
    case 'P':
      return children() + '\n\n';
    case 'CODE':
      return '`' + children() + '`';
    case 'STRONG':
      return '**' + children() + '**';
    case 'UL':
    case 'OL':
      return (
        [...node.children]
          .map((li, index) => (node.nodeName === 'UL' ? '- ' : index + 1 + '. ') + markdown(li))
          .join('\n') + '\n\n'
      );
    case 'TABLE': {
      const lines = [...node.rows].map((row) => '| ' + [...row.cells].map(markdown).join(' | ') + ' |');
      lines.splice(
        1,
        0,
        '| ' +
          [...node.rows[0].cells].map((cell) => (cell.classList.contains('n') ? '---:' : '---')).join(' | ') +
          ' |',
      );
      return lines.join('\n') + '\n\n';
    }
    case 'DIV':
      if (node.classList.contains('cb')) {
        const lang = node.querySelector('small').textContent.toLowerCase();
        return '```' + lang + '\n' + node.textContent.slice(lang.length) + '\n```\n\n';
      }
  }
  return children();
}

const duration = (label) =>
  [...label.matchAll(/(\d+(?:\.\d+)?)([ms])\b/g)].reduce(
    (total, [, amount, unit]) => total + Number(amount) * (unit === 'm' ? 60_000 : 1000),
    0,
  );

function tool(row) {
  const body = JSDOM.fragment(typeof row.body === 'string' ? row.body : '');
  const lines = (selector) => [...body.querySelectorAll(selector)].map((node) => node.textContent).join('\n');
  const kv = Object.fromEntries(
    [...body.querySelectorAll('.tkv')].map((group) => [
      group.querySelector('.k').textContent,
      [...group.querySelectorAll('.l')].map((line) => line.textContent).join('\n'),
    ]),
  );
  const path = row.w?.replace(/^in /, '');
  const inputForVerb = {
    Read: ['Read', { file_path: row.t }],
    Searched: ['Grep', { pattern: row.t?.replace(/^"|"$/g, ''), path }],
    Found: ['Glob', { pattern: row.t, path }],
    Ran: ['Bash', { command: row.t }],
    Fetched: ['WebFetch', { url: body.querySelector('a')?.textContent }],
    Wrote: ['Write', { file_path: row.t, content: lines('.tcode .l span:last-child') }],
    Edited: [
      'Edit',
      {
        file_path: row.t,
        old_string: lines('.tcode .del span:last-child'),
        new_string: lines('.tcode .add span:last-child'),
      },
    ],
    Called: [row.i === 'plug' ? 'mcp__gitHub__' + row.t : row.t, JSON.parse(kv.Arguments ?? '{}')],
  };
  const childText = (label) =>
    JSDOM.fragment(row.body?.find?.((item) => item.html?.includes(`>${label}<`))?.html ?? '').querySelector(
      'p:last-child',
    )?.textContent;
  const child = {
    bot: ['Task', { description: row.t, subagent_type: row.v, prompt: childText('Prompt') }],
    botf: ['mcp__mainframe__delegate_task', { title: row.t, adapterId: 'codex', task: childText('Task') }],
  };
  const [title, input] = child[row.i] ?? inputForVerb[row.v] ?? [row.v, { description: row.t }];
  return {
    title,
    input,
    durationMs: duration(row.m ?? ''),
    output:
      (childText('Result') ??
        kv.Result ??
        kv.Error ??
        lines('.tcode .l span:last-child, .tterm .l, .tfetch > span, .thits > span')) ||
      body.textContent,
    failed: row.st === 'bad',
  };
}

export const prototypeWindow = {
  projectColors: PCOL,
  session: TPL.s1,
  turns: TPL.s1.msgs.map((part) => {
    if (part.k !== 'turn') return part;
    const turn = TURNS[part.id];
    return {
      k: part.k,
      time: turn.time,
      durationMs: duration(turn.title),
      answer: markdown(JSDOM.fragment(turn.ans)).trim(),
      rows: turn.rows.map((row) => (row.i === 'spark' ? { thought: JSDOM.fragment(row.body).textContent } : tool(row))),
    };
  }),
};
