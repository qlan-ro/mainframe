/** The permission gate shows, in full, everything "Always allow" will save. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ControlUpdate } from '@qlan-ro/mainframe-types';
import type { GateContext } from '../gate-types';
import { PermissionGate } from '../PermissionGate';

const rules = (ruleContent: string): ControlUpdate => ({
  type: 'addRules',
  rules: [{ toolName: 'Bash', ruleContent }],
  behavior: 'allow',
  destination: 'localSettings',
});
const bypass = { type: 'setMode', mode: 'bypassPermissions', destination: 'session' } as unknown as ControlUpdate;

const HEBREW = '/Users/dana/\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8/src';

function renderGate(
  suggestions: ControlUpdate[],
  input: Record<string, unknown> = {},
  { toolName = 'Bash', context }: { toolName?: string; context?: GateContext } = {},
) {
  const reply = vi.fn().mockResolvedValue(undefined);
  render(
    <TooltipProvider>
      <PermissionGate
        reply={reply}
        context={context}
        entry={{
          requestId: 'r1',
          askedAt: 1,
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
          request: { requestId: 'r1', toolName, toolUseId: 'tu1', input, suggestions },
        }}
      />
    </TooltipProvider>,
  );
  return reply;
}

const listed = () =>
  within(screen.getByTestId('chat-permission-grants'))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

const omitted = () =>
  within(screen.getByTestId('chat-permission-omitted'))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('what "Always allow" saves', () => {
  it('lists every rule, not just the first, and sends exactly those', () => {
    const updates = [rules('cargo test *'), rules('cargo build *')];
    const reply = renderGate(updates);

    expect(listed()).toEqual([
      'Allow Bash(cargo test *) in this project’s local settings',
      'Allow Bash(cargo build *) in this project’s local settings',
    ]);
    fireEvent.click(screen.getByTestId('chat-permission-option-allow-always'));
    expect(reply.mock.calls[0]![0].updatedPermissions).toEqual(updates);
  });

  it('a bypass mode riding along is not sent, and the gate says it was left out', () => {
    const reply = renderGate([rules('cargo test *'), bypass]);

    expect(listed()).toEqual(['Allow Bash(cargo test *) in this project’s local settings']);
    expect(omitted()).toEqual(['switching permissions to Unattended']);
    expect(screen.getByTestId('chat-permission-omitted')).toHaveTextContent(/^Left out of Always allow/);
    fireEvent.click(screen.getByTestId('chat-permission-option-allow-always'));
    expect(reply.mock.calls[0]![0].updatedPermissions).toEqual([rules('cargo test *')]);
  });

  it('does not offer "Always allow" when nothing would be left to save', () => {
    renderGate([bypass]);

    expect(screen.queryByTestId('chat-permission-option-allow-always')).toBeNull();
    expect(screen.queryByTestId('chat-permission-grants')).toBeNull();
    expect(screen.getByTestId('chat-permission-omitted')).toHaveTextContent(/^Always allow is not offered/);
    expect(omitted()).toEqual(['switching permissions to Unattended']);
    expect(screen.getByTestId('chat-permission-option-allow-once')).toBeInTheDocument();
  });

  it('keeps an adapter’s own "always" when it suggests no updates', () => {
    renderGate([]);

    expect(screen.getByTestId('chat-permission-option-allow-always')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-permission-grants')).toBeNull();
  });
});

describe('a suggestion the gate cannot read', () => {
  it('does not take the gate down: it is left out, said so, and never sent', () => {
    const unknown = { type: 'grantEverything', destination: 'session' } as unknown as ControlUpdate;
    const reply = renderGate([unknown, null as unknown as ControlUpdate, rules('cargo test *')]);

    expect(listed()).toEqual(['Allow Bash(cargo test *) in this project’s local settings']);
    expect(omitted()).toEqual([
      'a kind of change this version does not know (“grantEverything”)',
      'a change that could not be read',
    ]);
    fireEvent.click(screen.getByTestId('chat-permission-option-allow-always'));
    expect(reply.mock.calls[0]![0].updatedPermissions).toEqual([rules('cargo test *')]);
  });
});

describe('a long list', () => {
  const forty = Array.from({ length: 40 }, (_, i) => rules(`tool-${i} *`));

  it('says on the button how many changes it saves', () => {
    renderGate(forty);

    expect(screen.getByTestId('chat-permission-option-allow-always')).toHaveTextContent('Always allow40 changes');
    expect(screen.queryByTestId('chat-permission-rule')).toBeNull();
  });

  it('has no scroller of its own that would hide the end of it', () => {
    renderGate(forty);

    const list = within(screen.getByTestId('chat-permission-grants')).getByRole('list');
    expect(listed()).toHaveLength(40);
    expect(list.className).not.toMatch(/max-h|overflow/);
  });

  it('one rule is named on the button instead', () => {
    renderGate([rules('cargo test *')]);

    expect(screen.getByTestId('chat-permission-rule')).toHaveTextContent('Bash(cargo test *)');
    expect(screen.queryByTestId('chat-permission-grant-count')).toBeNull();
  });
});

describe('text that could mislead', () => {
  const exact = (testId: string) => screen.getByTestId(testId);

  it('shows a rule’s spaces, and spells out its line breaks and overrides', () => {
    renderGate([rules('rm  -rf\n\u202Ex')]);

    const subject = within(screen.getByTestId('chat-permission-grants')).getByText(/rm/);
    expect(subject.textContent).toBe('Bash(rm  -rf⟨U+000A⟩⟨U+202E⟩x)');
    expect(subject).toHaveClass('whitespace-pre-wrap');
    expect(subject).toHaveAttribute('dir', 'ltr');
    expect(exact('chat-permission-rule').textContent).toBe('Bash(rm  -rf⟨U+000A⟩⟨U+202E⟩x)');
    expect(exact('chat-permission-rule')).toHaveClass('whitespace-pre');
  });

  it('keeps a command’s lines and spells out what cannot be seen', () => {
    renderGate([], { command: 'echo  a\nrm \u202Ehs.x\u200B' });

    expect(exact('chat-permission-command').textContent).toBe('echo  a\nrm ⟨U+202E⟩hs.x⟨U+200B⟩');
    expect(exact('chat-permission-command')).toHaveClass('whitespace-pre-wrap');
    expect(exact('chat-permission-command')).toHaveAttribute('dir', 'ltr');
  });

  it('does the same in the details', () => {
    renderGate([], { command: 'rm \u202Ehs.x' });
    fireEvent.click(screen.getByTestId('chat-permission-details-toggle'));

    expect(exact('chat-permission-details-pre').textContent).toContain('rm ⟨U+202E⟩hs.x');
  });
});

describe('a tall command', () => {
  const command = () => screen.getByTestId('chat-permission-command');

  it.each([
    ['a ten-line gap before its last line', `echo ok${'\n'.repeat(11)}rm -rf ~`, '12 lines'],
    ['200 lines', Array.from({ length: 200 }, (_, i) => `step ${i}`).join('\n'), '200 lines'],
  ])('with %s is shown to its end, with no scroller of its own, and counted', (_what, text, count) => {
    renderGate([], { command: text });

    expect(command().textContent).toBe(text);
    for (let el: Element | null = command(); el !== null; el = el.parentElement) {
      expect(el.className).not.toMatch(/max-h|overflow-(y-)?(auto|scroll|hidden)|line-clamp|truncate/);
    }
    expect(screen.getByTestId('chat-permission-command-lines')).toHaveTextContent(count);
  });

  it('keeps the answers after it in the sticky footer', () => {
    renderGate([], { command: 'a\n'.repeat(200) });

    expect(screen.getByTestId('chat-permission-options').className).toMatch(/sticky/);
    expect(
      command().compareDocumentPosition(screen.getByTestId('chat-permission-options')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('a one-line command is not counted', () => {
    renderGate([], { command: 'ls -la' });

    expect(screen.queryByTestId('chat-permission-command-lines')).toBeNull();
  });
});

describe('right-to-left text', () => {
  const stored = (element: HTMLElement) => {
    expect(element).toHaveClass('stored-order');
    expect(element.textContent).toContain('\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8');
  };

  it('a rule, in the list and on the button', () => {
    renderGate([rules(`cat ${HEBREW}`)]);

    stored(within(screen.getByTestId('chat-permission-grants')).getByText(/cat/));
    stored(screen.getByTestId('chat-permission-rule'));
  });

  it('a directory', () => {
    renderGate([{ type: 'addDirectories', directories: [HEBREW], destination: 'session' }]);

    stored(within(screen.getByTestId('chat-permission-grants')).getByText(/dana/));
  });

  it('a command and its details', () => {
    renderGate([], { command: `cat ${HEBREW}` });
    fireEvent.click(screen.getByTestId('chat-permission-details-toggle'));

    stored(screen.getByTestId('chat-permission-command'));
    stored(screen.getByTestId('chat-permission-details-pre'));
  });

  it('a name in what was left out', () => {
    renderGate([{ type: HEBREW, destination: 'session' } as unknown as ControlUpdate]);

    stored(within(screen.getByTestId('chat-permission-omitted')).getByRole('listitem'));
  });

  it('a tool’s name', () => {
    renderGate([], {}, { toolName: HEBREW });

    stored(screen.getByText(HEBREW));
  });
});

describe('who is asking', () => {
  it('spells out what hides in the asker and the title, and keeps their order', () => {
    renderGate([], {}, { context: { asker: 'review\u202Eer\nAllowed', title: 'Read\u200B only \u2028now', more: 1 } });

    const eyebrow = screen.getByTestId('gate-head-eyebrow');
    expect(eyebrow.textContent).toBe('Permission required · review⟨U+202E⟩er⟨U+000A⟩Allowed · 1 more waiting');
    expect(eyebrow).toHaveClass('stored-order');
    const title = screen.getByTestId('gate-head-title');
    expect(title.textContent).toBe('Read⟨U+200B⟩ only ⟨U+2028⟩now');
    expect(title).toHaveClass('stored-order');
  });
});

describe('hidden text in what is saved', () => {
  it('is spelled out in a directory', () => {
    renderGate([
      { type: 'addDirectories', directories: ['/a\u202Eb'], destination: 'session' },
      { type: 'removeDirectories', directories: ['/c\u200Bd'], destination: 'session' },
    ]);

    expect(listed()).toEqual(['Work in /a⟨U+202E⟩b for this session', 'Stop working in /c⟨U+200B⟩d for this session']);
  });

  it('is spelled out in the tool’s name', () => {
    renderGate([], {}, { toolName: 'Ba\u202Esh\nAllowed' });

    expect(screen.getByText('Ba⟨U+202E⟩sh⟨U+000A⟩Allowed')).toBeInTheDocument();
  });

  it('is spelled out in the tool a rule names', () => {
    renderGate([
      {
        type: 'addRules',
        rules: [{ toolName: 'Ba\u202Esh' }, { toolName: 'Re\u200Bad', ruleContent: 'x' }],
        behavior: 'allow',
        destination: 'session',
      },
    ]);

    expect(listed()).toEqual(['Allow Ba⟨U+202E⟩sh for this session', 'Allow Re⟨U+200B⟩ad(x) for this session']);
  });
});
