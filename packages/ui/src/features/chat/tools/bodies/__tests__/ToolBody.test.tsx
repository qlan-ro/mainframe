import { fireEvent, render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolPart, ToolStatus } from '../../../view-model/turn/types';
import { ToolBody, hasToolBody } from '../ToolBody';

vi.mock('../../chat-tool-context', () => ({ useChatId: () => 'chat', useOpenFile: () => ({}) }));
vi.mock('../../../links/use-open-link', () => ({ useOpenLink: () => ({ open: opened, openIn: opened }) }));
vi.mock('../../../messages/turn/use-background-start', () => ({ useBackgroundStart: () => background.startedAt }));
vi.mock('../BackgroundOutput', () => ({
  BackgroundOutput: ({ launch }: { launch: string }) => <div data-testid="background">{launch}</div>,
}));
vi.mock('@/lib/shiki-tokens', () => ({ useShikiTokens: () => null, TokenLine: () => null }));
vi.mock('../../ToolResultExpand', () => ({
  ToolResultExpand: ({ toolUseId, fullBytes }: { toolUseId: string; fullBytes: number }) => (
    <div data-testid="expand">{`${toolUseId}:${fullBytes}`}</div>
  ),
}));
const opened = vi.fn();
const { background } = vi.hoisted(() => ({ background: { startedAt: undefined as number | undefined } }));
beforeEach(() => {
  background.startedAt = undefined;
});

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
const show = (value: ToolPart, status: ToolStatus = 'success') =>
  render(
    <TooltipProvider>
      <ToolBody part={value} status={status} />
    </TooltipProvider>,
  );

describe('ToolBody', () => {
  it('numbers a read file as the CLI numbered it, its reminders apart', () => {
    const reminder = '<system-reminder>\nMind the license.\n</system-reminder>';
    show(part('Read', { file_path: 'a.ts' }, `     8→const a = 1;\n     9→\n\n${reminder}`));
    expect(screen.getByTestId('read-card-code-preview').textContent).toBe('8const a = 1;9');
    expect(screen.getByTestId('chat-read-reminder')).toHaveTextContent('Mind the license.');
    expect(screen.queryByText(/system-reminder/)).toBeNull();
  });

  it('says nothing of reminders where there are none', () => {
    show(part('Read', { file_path: 'a.ts' }, '     1→a\n     2→b'));
    expect(screen.queryByTestId('chat-read-reminder')).toBeNull();
  });

  it('names an MCP call by its raw tool name', () => {
    show(part('mcp__claude_ai_github__get_issue', { id: 1 }, 'ok'));
    expect(screen.getByTestId('chat-call-tool')).toHaveTextContent('mcp__claude_ai_github__get_issue');
  });

  it('offers the whole of a structured result the daemon cut short', () => {
    const result = { content: 'Error: …', structuredPatch: [], truncated: true, fullBytes: 51_191 };
    show(part('Edit', { file_path: 'a', old_string: 'a', new_string: 'b' }, result), 'failed');
    expect(screen.getByTestId('expand')).toHaveTextContent('call:51191');
  });

  it('leaves no escape sequence in a command’s output', () => {
    const esc = '\u001b';
    const output = [
      `${esc}]0;building${esc}\\${esc}[32mok${esc}[0m`,
      `${esc}]8;;https://example.com\u0007docs${esc}]8;;\u0007`,
      `${esc}(B${esc}7plain${esc}8`,
      `${esc}]0;cut`,
      'last',
    ].join('\n');
    show(part('Bash', { command: 'x' }, output));
    expect(screen.getByTestId('chat-bash-output').textContent).toBe('okdocsplainlast');
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

  it('shows why an edit failed, and what it tried to change', () => {
    show(part('Edit', { file_path: 'a', old_string: 'a', new_string: 'b' }, 'String not found'), 'failed');
    expect(screen.getByTestId('chat-tool-error')).toHaveTextContent('String not found');
    expect(screen.getByTestId('chat-edit-diff')).toHaveTextContent('−a');
  });

  it.each([
    ['Read', { file_path: 'a' }],
    ['Grep', { pattern: 'x' }],
    ['Edit', { file_path: 'a', old_string: 'a', new_string: 'b' }],
    ['Write', { file_path: 'a', content: 'x' }],
    ['Bash', { command: 'x' }],
    ['WebFetch', { url: 'https://example.com' }],
    ['mcp__a__b', { q: 1 }],
  ])('offers the whole of a failed %s the daemon cut short', (name, args) => {
    show(part(name, args, { content: 'boom', truncated: true, fullBytes: 9000 }), 'failed');
    expect(screen.getByTestId('expand')).toHaveTextContent('call:9000');
  });

  it.each([['1\tone\n2\ttwo\nplain'], ['1→a\n\n<system-reminder>kept</system-reminder>\nend'], ['first\n2\tsecond']])(
    'shows a written file whole, however its lines look (%j)',
    (content) => {
      show(part('Write', { file_path: 'a.tsv', content }, 'File created successfully at: a.tsv'));
      const shown = [...screen.getByTestId('chat-write-code').children].map(
        (line) => line.lastElementChild!.textContent,
      );
      expect(shown.join('\n')).toBe(content);
    },
  );

  it('keeps every line of a read whose file starts with a number of its own', () => {
    show(part('Read', { file_path: 'a.tsv' }, '7\tone\n12\ttwo\nplain'));
    const shown = [...screen.getByTestId('read-card-code-preview').children].map(
      (l) => l.lastElementChild!.textContent,
    );
    expect(shown.join('\n')).toBe('7\tone\n12\ttwo\nplain');
  });

  it.each([
    'Command running in background with ID: b1. Output is being written to: /tmp/b1.output',
    'Command did not complete within its 120s timeout and was moved to the background (ID: b1). Output is being written to: /tmp/b1.output',
  ])('reads the output of a command the CLI moved to the background itself (%s)', (launch) => {
    show(part('Bash', { command: 'pnpm dev' }, launch));
    expect(screen.getByTestId('background')).toHaveTextContent('b1');
  });

  it('reads the output of a command the daemon lists as a running task, whatever the call said', () => {
    background.startedAt = 1000;
    show(part('Bash', { command: 'pnpm dev' }, 'ok'), 'running');
    expect(screen.getByTestId('background')).toBeVisible();
  });

  it('shows a written file’s content', () => {
    show(part('Write', { file_path: 'a.ts', content: 'x' }, 'File created successfully at: a.ts'));
    expect(screen.getByTestId('chat-write-code')).toHaveTextContent('1x');
  });

  it('prints command output without repeating the command or including escape codes', () => {
    show(part('Bash', { command: 'ls', description: 'List files' }, '\u001b[32ma.ts\u001b[0m'));
    expect(screen.getByTestId('chat-bash-output')).toHaveTextContent('a.ts');
    expect(screen.getByTestId('chat-bash-description')).toHaveTextContent('List files');
    expect(screen.getByRole('region', { name: 'Command output' })).toHaveAttribute('tabindex', '0');
  });

  it('offers the whole of a result the daemon cut short', () => {
    show(part('Bash', { command: 'ls' }, { content: 'a', truncated: true, fullBytes: 9000 }));
    expect(screen.getByTestId('expand')).toHaveTextContent('call:9000');
  });

  it('opens a fetched page where links open', () => {
    show(part('WebFetch', { url: 'https://example.com' }, 'A page'));
    fireEvent.click(within(screen.getByTestId('web-fetch-card-url')).getByRole('link'));
    expect(opened).toHaveBeenCalledWith('https://example.com');
  });

  it('shows a call’s arguments and its result, or its error', () => {
    const { rerender } = show(part('mcp__a__b', { q: 1 }, 'fine'));
    expect(screen.getByTestId('chat-call-args')).toHaveTextContent('{ "q": 1 }');
    expect(within(screen.getByTestId('chat-call-body')).getByText('Result')).toBeVisible();
    rerender(
      <TooltipProvider>
        <ToolBody part={part('mcp__a__b', { q: 1 }, '404')} status="failed" />
      </TooltipProvider>,
    );
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
