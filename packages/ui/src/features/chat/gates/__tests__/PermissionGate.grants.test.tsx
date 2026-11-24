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

function renderGate(suggestions: ControlUpdate[]) {
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
          request: { requestId: 'r1', toolName: 'Bash', toolUseId: 'tu1', input: {}, suggestions },
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

  it('a bypass mode riding along is neither shown nor sent', () => {
    const reply = renderGate([rules('cargo test *'), bypass]);

    expect(listed()).toEqual(['Allow Bash(cargo test *) in this project’s local settings']);
    fireEvent.click(screen.getByTestId('chat-permission-option-allow-always'));
    expect(reply.mock.calls[0]![0].updatedPermissions).toEqual([rules('cargo test *')]);
  });

  it('does not offer "Always allow" when nothing would be left to save', () => {
    renderGate([bypass]);

    expect(screen.queryByTestId('chat-permission-option-allow-always')).toBeNull();
    expect(screen.queryByTestId('chat-permission-grants')).toBeNull();
    expect(screen.getByTestId('chat-permission-option-allow-once')).toBeInTheDocument();
  });

  it('keeps an adapter’s own "always" when it suggests no updates', () => {
    renderGate([]);

    expect(screen.getByTestId('chat-permission-option-allow-always')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-permission-grants')).toBeNull();
  });
});
