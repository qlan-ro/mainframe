import { describe, expect, it } from 'vitest';
import { rowName, toolRowFacts } from '../tool-row';
import type { ToolPart, ToolStatus } from '../types';
import { bash, call } from './fixtures';

const row = (part: ToolPart, status: ToolStatus = 'success') => {
  const { verb, target, mono, where, receipt, diff } = toolRowFacts(part, status);
  return { verb, target, mono, where, receipt, diff };
};

describe('verb, target and receipt by tool', () => {
  it.each<[string, ToolPart, Partial<ReturnType<typeof row>>]>([
    [
      'read',
      call('Read', { file_path: 'src/a.ts' }, { result: 'one\ntwo\n' }),
      { verb: 'Read', target: 'src/a.ts', receipt: '2 lines' },
    ],
    ['one line', call('Read', { file_path: 'a' }, { result: 'one' }), { receipt: '1 line' }],
    ['image', call('Read', { file_path: 'a.png' }, { result: { content: '', images: [{}] } }), { receipt: 'image' }],
    [
      'truncated read',
      call('Read', { file_path: 'a' }, { result: { content: 'x\ny', truncated: true, fullBytes: 9 } }),
      { receipt: undefined },
    ],
    [
      'new file',
      call('Write', { file_path: 'a.rs', content: 'x\ny' }, { result: 'File created successfully at: a.rs' }),
      { verb: 'Wrote', receipt: 'new · 2 lines', diff: undefined },
    ],
    [
      'edit',
      call('Edit', { file_path: 'a.rs', old_string: 'a', new_string: 'b\nc' }),
      { verb: 'Edited', receipt: undefined, diff: { added: 2, removed: 1 } },
    ],
    [
      'grep',
      call('Grep', { pattern: 'resets_at', path: 'packages' }, { result: 'a:1\nb:2\nc:3' }),
      { verb: 'Searched', target: '"resets_at"', where: 'in packages', receipt: '3 matches' },
    ],
    ['grep files', call('Grep', { pattern: 'x' }, { result: 'Found 2 files\na\nb' }), { receipt: '2 files' }],
    ['grep nothing', call('Grep', { pattern: 'x' }, { result: 'No matches found' }), { receipt: 'no matches' }],
    [
      'glob',
      call('Glob', { pattern: '**/*.rs' }, { result: 'a\nb' }),
      { verb: 'Found', target: '**/*.rs', receipt: '2 files' },
    ],
    ['ls', call('LS', { path: 'crates' }, { result: 'a\nb\nc' }), { verb: 'Listed', receipt: '3 entries' }],
    ['command', bash('cargo test'), { verb: 'Ran', target: 'cargo test', mono: true, receipt: 'exit 0' }],
    [
      'background',
      bash('', { args: { command: 'pnpm dev', run_in_background: true } }),
      { receipt: 'in the background' },
    ],
    [
      'moved to the background by the CLI',
      bash('pnpm dev', { result: 'Command running in background with ID: b1. Output is being written to: /tmp/o' }),
      { receipt: 'in the background' },
    ],
    ['web search', call('WebSearch', { query: 'codex' }), { verb: 'Searched the web', target: '"codex"' }],
    ['fetch', call('WebFetch', { url: 'https://example.com/a' }), { verb: 'Fetched', target: 'example.com/a' }],
    ['mcp', call('mcp__github__get_issue', {}), { verb: 'Called', target: 'get_issue', where: 'on Github' }],
    [
      'mcp images',
      call('mcp__playwright__shot', {}, { result: { content: '', images: [{}, {}] } }),
      { receipt: '2 images' },
    ],
    ['unregistered', call('docs__search', {}), { verb: 'Called', target: 'docs__search', where: undefined }],
    [
      'agent',
      call('Task', { subagent_type: 'code-reviewer', description: 'Review it' }),
      { verb: 'code-reviewer', target: 'Review it', mono: false },
    ],
    ['codex agent', call('CollabAgent', { prompt: 'Explore' }), { verb: 'Codex agent', target: 'Explore' }],
    [
      'delegate',
      call('mcp__mainframe__delegate_task', { title: 'Check it', task: 'long' }),
      { verb: 'Delegated', target: 'Check it', mono: false },
    ],
    ['workflow', call('Workflow', { name: 'review' }), { verb: 'Started workflow', target: 'review' }],
  ])('%s', (_name, part, expected) => expect(row(part)).toMatchObject(expected));

  it('says what Codex reported a command did', () => {
    const part = bash('sed -n 1,9p a.rs', {
      providerMetadata: {
        codex: { commandActions: [{ type: 'read', command: 'sed', name: 'a.rs', path: 'src/a.rs' }] },
      },
    });
    expect(row(part)).toMatchObject({ verb: 'Read', target: 'src/a.rs', receipt: undefined });
  });
});

describe('verb and receipt by status', () => {
  it.each<[ToolStatus, string, string | undefined]>([
    ['running', 'Running', undefined],
    ['success', 'Ran', 'exit 0'],
    ['stopped', 'Ran', 'stopped'],
    ['declined', 'Did not run', 'declined'],
    ['awaiting-approval', 'Wants to run', 'needs approval'],
    ['unknown', 'Ran', 'no result'],
  ])('%s', (status, verb, receipt) => expect(row(bash('x'), status)).toMatchObject({ verb, receipt }));

  it('states the exit code of a failed command when it has one', () => {
    expect(row(bash('x', { result: 'Exit code 2\nboom', isError: true }), 'failed').receipt).toBe('exit 2');
    expect(row(bash('x', { result: 'boom', isError: true }), 'failed').receipt).toBe('failed');
    expect(row(call('mcp__a__b', {}, { isError: true }), 'failed').receipt).toBe('failed');
  });

  it('claims no change for an edit that failed', () => {
    expect(row(call('Edit', { file_path: 'a', old_string: 'a', new_string: 'b' }), 'failed').diff).toBeUndefined();
  });
});

it('names the row in one sentence, stripped of control characters', () => {
  expect(rowName({ verb: 'Searched', target: '"a\u001b[31mb"', where: 'in src' })).toBe('Searched "ab" in src');
});
