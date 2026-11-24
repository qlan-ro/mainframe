/** The permission gate shows, in full, everything "Always allow" will save. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ControlUpdate } from '@qlan-ro/mainframe-types';
import { PermissionGate } from '../PermissionGate';

const rules = (ruleContent: string): ControlUpdate => ({
  type: 'addRules',
  rules: [{ toolName: 'Bash', ruleContent }],
  behavior: 'allow',
  destination: 'localSettings',
});
const bypass = { type: 'setMode', mode: 'bypassPermissions', destination: 'session' } as unknown as ControlUpdate;

function renderGate(suggestions: ControlUpdate[], input: Record<string, unknown> = {}) {
  const reply = vi.fn().mockResolvedValue(undefined);
  render(
    <TooltipProvider>
      <PermissionGate
        reply={reply}
        entry={{
          requestId: 'r1',
          askedAt: 1,
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
          request: { requestId: 'r1', toolName: 'Bash', toolUseId: 'tu1', input, suggestions },
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
