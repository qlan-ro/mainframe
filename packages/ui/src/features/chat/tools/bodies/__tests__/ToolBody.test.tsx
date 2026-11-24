import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ToolPart, ToolStatus } from '../../../view-model/turn/types';
import { ToolBody, hasToolBody } from '../ToolBody';

vi.mock('../../chat-tool-context', () => ({ useChatId: () => 'chat', useOpenFile: () => ({}) }));
vi.mock('../../../links/use-open-link', () => ({ useOpenLink: () => ({ open: opened }) }));
vi.mock('@/lib/shiki-tokens', () => ({ useShikiTokens: () => null, TokenLine: () => null }));
vi.mock('../../ToolResultExpand', () => ({
  ToolResultExpand: ({ toolUseId, fullBytes }: { toolUseId: string; fullBytes: number }) => (
    <div data-testid="expand">{`${toolUseId}:${fullBytes}`}</div>
  ),
}));
const opened = vi.fn();

const part = (toolName: string, args: object, result?: unknown) =>
  ({
    type: 'tool-call',
    toolCallId: 'call',
    toolName,
    args,
    argsText: '',
    result,
    status: { type: 'complete' },
  }) as unknown as ToolPart;
const show = (value: ToolPart, status: ToolStatus = 'success') => render(<ToolBody part={value} status={status} />);

describe('ToolBody', () => {
  it('numbers a read file as the CLI numbered it, without its reminders', () => {
    show(part('Read', { file_path: 'a.ts' }, '     8→const a = 1;\n     9→\n\n<system-reminder>x</system-reminder>'));
    expect(screen.getByTestId('read-card-code-preview')).toHaveTextContent('8const a = 1;9');
    expect(screen.queryByText(/system-reminder/)).toBeNull();
  });

  it('clamps a long file and shows the rest on request', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    show(part('Read', { file_path: 'a.ts' }, text));
    expect(screen.queryByText('line 30')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 30 lines' }));
    expect(screen.getByText('line 30')).toBeVisible();
  });

  it('draws an edit with one line number per row and its sign', () => {
    show(part('Edit', { file_path: 'a.ts', old_string: 'one\ntwo', new_string: 'one\nthree' }, 'ok'));
    const lines = [...screen.getByTestId('chat-edit-diff').querySelectorAll<HTMLElement>('[data-diff]')];
    expect(lines.map((line) => [line.dataset.diff, line.textContent])).toEqual([
      ['ctx', '1one'],
      ['del', '2Removed: −two'],
      ['add', '2Added: +three'],
    ]);
  });

  it('shows why an edit failed, and no diff', () => {
    show(part('Edit', { file_path: 'a', old_string: 'a', new_string: 'b' }, 'String not found'), 'failed');
    expect(screen.getByTestId('chat-tool-error')).toHaveTextContent('String not found');
    expect(screen.queryByTestId('chat-edit-diff')).toBeNull();
  });

  it('shows a written file’s content', () => {
    show(part('Write', { file_path: 'a.ts', content: 'x' }, 'File created successfully at: a.ts'));
    expect(screen.getByTestId('chat-write-code')).toHaveTextContent('1x');
  });

  it('prints a command and its output, without escape codes', () => {
    show(part('Bash', { command: 'ls', description: 'List files' }, '\u001b[32ma.ts\u001b[0m'));
    expect(screen.getByTestId('chat-bash-output')).toHaveTextContent('$ lsa.ts');
    expect(screen.getByTestId('chat-bash-description')).toHaveTextContent('List files');
    expect(screen.getByRole('region', { name: 'Command output' })).toHaveAttribute('tabindex', '0');
  });

  it('offers the whole of a result the daemon cut short', () => {
    show(part('Bash', { command: 'ls' }, { content: 'a', truncated: true, fullBytes: 9000 }));
    expect(screen.getByTestId('expand')).toHaveTextContent('call:9000');
  });

  it('opens a fetched page where links open', () => {
    show(part('WebFetch', { url: 'https://example.com' }, 'A page'));
    fireEvent.click(screen.getByTestId('web-fetch-card-url'));
    expect(opened).toHaveBeenCalledWith('https://example.com');
  });

  it('shows a call’s arguments and its result, or its error', () => {
    const { rerender } = show(part('mcp__a__b', { q: 1 }, 'fine'));
    expect(screen.getByTestId('chat-call-args')).toHaveTextContent('{ "q": 1 }');
    expect(within(screen.getByTestId('chat-call-body')).getByText('Result')).toBeVisible();
    rerender(<ToolBody part={part('mcp__a__b', { q: 1 }, '404')} status="failed" />);
    expect(within(screen.getByTestId('chat-call-body')).getByText('Error')).toHaveClass('text-fail');
  });
});

it.each<[string, ToolPart, ToolStatus, boolean]>([
  ['a read still running', part('Read', { file_path: 'a' }), 'running', false],
  ['a command that printed nothing', part('Bash', { command: 'true' }, ''), 'success', true],
  ['a running command', part('Bash', { command: 'ls' }), 'running', false],
  ['a background command', part('Bash', { command: 'ls', run_in_background: true }), 'running', true],
  ['a call with arguments', part('docs__search', { q: 1 }), 'running', true],
  ['a call without any', part('docs__search', {}), 'running', false],
])('%s', (_name, value, status, expected) => expect(hasToolBody(value, status)).toBe(expected));
