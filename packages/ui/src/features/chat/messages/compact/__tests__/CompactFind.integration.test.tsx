import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TurnFixture, finalMessage, turnMessage } from './turn-fixtures';
import { useUiPrefs } from '@/store/ui-prefs';
import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import { DaemonFind } from '../../../find/DaemonFind';
import { FindBar } from '../../../find/FindBar';
import { useFindInChatStore } from '../../../find/find-in-chat-store';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
afterEach(() => useFindInChatStore.getState().close());

it('stepping to a daemon match opens a closed compact work turn', async () => {
  useUiPrefs.getState().setTranscriptMode('compact');
  useFindInChatStore.getState().open();
  useFindInChatStore.getState().setQuery('Hidden work');
  const loadEarlier = vi.fn().mockResolvedValue(false);
  const searchHistory = vi.fn().mockResolvedValue({
    total: 1,
    matches: [{ containerId: 'work', itemId: 'work-item', occurrence: 0 }],
  });
  const extras = buildChatExtras(
    { canSearchHistory: true, searchHistory, loadEarlier } as unknown as AcpChatController,
    31415,
    createChatThreadState('chat-fixture'),
  );
  render(
    <div data-mf-chat-thread data-mf-chat-id="chat-fixture">
      <TurnFixture
        rootId="closed-find-turn"
        messages={[turnMessage('work', 'Hidden work'), finalMessage()]}
        extras={extras}
      >
        <FindBar />
        <DaemonFind />
      </TurnFixture>
    </div>,
  );
  const toggle = await screen.findByRole('button', { name: 'Work details' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Hidden work')).not.toBeInTheDocument();
  await waitFor(() => expect(useFindInChatStore.getState().serverTotal).toBe(1));
  fireEvent.click(screen.getByTestId('thread-find-next'));
  expect(await screen.findByText('Hidden work')).toBeVisible();
  await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
  expect(loadEarlier).not.toHaveBeenCalled();
  await act(async () => useFindInChatStore.getState().close());
});
