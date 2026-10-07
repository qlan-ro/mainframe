import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { auiState, entry, setSessions } from './fixtures';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: typeof auiState) => unknown) => sel(auiState),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
const cancelAgentOutboxEntry = vi.fn<(port: number, chatId: string, entryId: string) => Promise<void>>();
vi.mock('@/lib/api/chats', () => ({
  cancelAgentOutboxEntry: (port: number, chatId: string, entryId: string) =>
    cancelAgentOutboxEntry(port, chatId, entryId),
}));
const warning = vi.fn();
vi.mock('@/lib/toast', () => ({ mfToast: { warning: (...args: unknown[]) => warning(...args) } }));

import { AgentOutboxChip } from '../AgentOutboxChip';

function renderChip() {
  return render(
    <TooltipProvider>
      <AgentOutboxChip />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  cancelAgentOutboxEntry.mockReset();
  warning.mockReset();
});

describe('AgentOutboxChip', () => {
  it('renders nothing while nothing is held', () => {
    setSessions(entry('target'));
    renderChip();
    expect(screen.queryByTestId('chat-composer-agent-outbox-chip')).toBeNull();
  });

  it('names the sender and cancels one held message through the daemon', async () => {
    cancelAgentOutboxEntry.mockResolvedValue();
    const held = [{ entryId: 'ob7', fromChatId: 'boss', preview: 'Please also run the linter' }];
    setSessions(entry('target', { agentOutbox: held }), [entry('boss', {}, 'Release prep')]);
    renderChip();

    const chip = screen.getByTestId('chat-composer-agent-outbox-chip');
    expect(chip).toHaveTextContent('1 message from "Release prep" after this turn');
    expect(chip).toHaveTextContent('Please also run the linter');

    await userEvent.click(screen.getByTestId('chat-composer-agent-outbox-cancel-ob7'));
    expect(cancelAgentOutboxEntry).toHaveBeenCalledWith(31415, 'target', 'ob7');
    expect(warning).not.toHaveBeenCalled();
  });

  it('says so when the message already went out', async () => {
    cancelAgentOutboxEntry.mockRejectedValue(new Error('404'));
    setSessions(entry('target', { agentOutbox: [{ entryId: 'ob1', fromChatId: 'gone', preview: 'x' }] }));
    renderChip();
    expect(screen.getByTestId('chat-composer-agent-outbox-chip')).toHaveTextContent('from "another chat"');

    await userEvent.click(screen.getByTestId('chat-composer-agent-outbox-cancel-ob1'));
    expect(warning).toHaveBeenCalledWith('That message was already sent');
  });
});
