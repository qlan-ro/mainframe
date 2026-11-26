import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { HistoryPageResult } from '@qlan-ro/mainframe-types';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { HistoricalAgentSteps } from '../HistoricalAgentSteps';
import { releaseSubagentHistory } from '../subagent-history-store';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { getOrCreate: () => ({ loadSubagentPage: request }) },
}));
vi.mock('../AgentSteps', () => ({
  AgentSteps: ({ messages }: { messages: Array<{ id: string }> }) => (
    <ol>
      {messages.map((message) => (
        <li key={message.id}>{message.id}</li>
      ))}
    </ol>
  ),
}));

function page(id: string, hasMore = false): HistoryPageResult {
  return {
    hasMore,
    ...(hasMore && { floorItemId: 'page-floor' }),
    updates: [
      {
        sessionUpdate: 'agent_message',
        messageId: id,
        content: [{ type: 'text', text: id }],
      },
    ],
  };
}

function show() {
  return render(
    <DaemonPortProvider port={1234}>
      <div data-conversation-scroller>
        <HistoricalAgentSteps chatId="chat" toolCallId="agent" messageId="parent" messages={[]} outcome="done" />
      </div>
    </DaemonPortProvider>,
  );
}

beforeEach(() => {
  releaseSubagentHistory('chat');
  request.mockReset();
});

it('loads on open and reuses the same page on reopen', async () => {
  let resolvePage!: (value: HistoryPageResult) => void;
  request.mockReturnValue(
    new Promise<HistoryPageResult>((resolve) => {
      resolvePage = resolve;
    }),
  );
  const view = show();
  expect(screen.getByRole('status')).toHaveTextContent('Loading sub-agent history…');
  expect(request).toHaveBeenCalledWith('agent', undefined);
  await act(async () => resolvePage(page('latest-step')));
  expect(screen.getByText('latest-step')).toBeVisible();
  view.unmount();
  show();
  expect(screen.getByText('latest-step')).toBeVisible();
  expect(request).toHaveBeenCalledTimes(1);
});

it('prepends an older page when the user scrolls up', async () => {
  request.mockResolvedValueOnce(page('latest-step', true)).mockResolvedValueOnce(page('older-step'));
  const view = show();
  await screen.findByText('latest-step');
  fireEvent.wheel(view.container.querySelector('[data-conversation-scroller]')!, { deltaY: -10 });
  await screen.findByText('older-step');
  expect(request).toHaveBeenLastCalledWith('agent', 'page-floor');
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['older-step', 'latest-step']);
});

it('replaces a stale transcript with a fresh newest page', async () => {
  request
    .mockResolvedValueOnce(page('stale-step', true))
    .mockResolvedValueOnce({ hasMore: false, stale: true })
    .mockResolvedValueOnce(page('replacement-step'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Earlier messages' }));
  expect(await screen.findByText('replacement-step')).toBeVisible();
  expect(screen.queryByText('stale-step')).toBeNull();
  expect(request.mock.calls).toEqual([
    ['agent', undefined],
    ['agent', 'page-floor'],
    ['agent', undefined],
  ]);
});

it('shows a retry after an error and loads content when retried', async () => {
  request.mockRejectedValueOnce(new Error('request failed')).mockResolvedValueOnce(page('recovered-step'));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load sub-agent history.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('recovered-step')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});
