import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HistoryPageResult } from '@qlan-ro/mainframe-types';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { useUiPrefs } from '@/store/ui-prefs';
import { TranscriptScrollProvider, type TranscriptScrollController } from '../../../thread/transcript-scroll-context';
import { HistoricalAgentSteps } from '../HistoricalAgentSteps';
import { historyKey, loadSubagentPage, releaseSubagentHistory } from '../subagent-history-store';
import { SUBAGENT_PAGES_KEPT } from '../subagent-window';
import { fakeSubagentPager } from './subagent-pager';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { getOrCreate: () => ({ subagentHistory: { page: request } }) },
}));
vi.mock('../AgentSteps', () => ({
  AgentSteps: ({
    messages,
    after,
    endsEarly,
  }: {
    messages: Array<{ id: string }>;
    after?: ReactNode;
    endsEarly?: boolean;
  }) => (
    <>
      <ol data-ends-early={endsEarly}>
        {messages.map((message) => (
          <li key={message.id}>{message.id}</li>
        ))}
      </ol>
      {after}
    </>
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

function show(scroll: TranscriptScrollController | null = null) {
  return render(
    <DaemonPortProvider port={1234}>
      <TranscriptScrollProvider value={scroll}>
        <div data-conversation-scroller>
          <HistoricalAgentSteps chatId="chat" toolCallId="agent" messageId="parent" messages={[]} outcome="done" />
        </div>
      </TranscriptScrollProvider>
    </DaemonPortProvider>,
  );
}

beforeEach(() => {
  releaseSubagentHistory('chat');
  request.mockReset();
});
afterEach(() => useUiPrefs.setState({ plainTranscript: false }));

const rows = () => screen.queryAllByRole('listitem').map((item) => item.textContent);

/** The sub-agent paged up until its newest pages were dropped. */
async function pagedPastTheCap(pager: ReturnType<typeof fakeSubagentPager>) {
  const key = historyKey('chat', 'agent');
  await loadSubagentPage(key, pager.request);
  for (let page = 0; page < SUBAGENT_PAGES_KEPT; page++) await loadSubagentPage(key, pager.request, 'older');
  request.mockImplementation((_agent: string, before?: string, until?: string) => pager.request(before, until));
}

it('offers the dropped newest pages below the steps and loads them back', async () => {
  await pagedPastTheCap(fakeSubagentPager(200));
  show();
  expect(screen.getByRole('list')).toHaveAttribute('data-ends-early', 'true');
  expect(rows()[0]).toBe('m40');
  fireEvent.click(screen.getByTestId('chat-agent-later-agent'));
  await screen.findByText('m199');
  expect(request).toHaveBeenLastCalledWith('agent', undefined);
  expect(rows()[0]).toBe('m80');
  expect(screen.queryByTestId('chat-agent-later-agent')).toBeNull();
  expect(screen.getByRole('list')).toHaveAttribute('data-ends-early', 'false');
});

it('tells the plain list scroll owner before the rows of a page commit', async () => {
  useUiPrefs.setState({ plainTranscript: true });
  await pagedPastTheCap(fakeSubagentPager(200));
  const seen: Array<Array<string | null>> = [];
  const beforePrepend = vi.fn(() => seen.push(rows()));
  show({
    owned: true,
    beforePrepend,
    viewportElement: { current: null },
    isFollowing: () => false,
    beginInteraction: () => () => undefined,
  });
  const shown = rows();
  fireEvent.click(screen.getByTestId('chat-agent-earlier-agent'));
  await screen.findByText('m0');
  // Once, for the page (the loading state changes no rows), while the reader's rows were still on screen.
  expect(beforePrepend).toHaveBeenCalledTimes(1);
  expect(seen[seen.length - 1]).toEqual(shown);
});

it('leaves the scroll position alone on the other list', async () => {
  await pagedPastTheCap(fakeSubagentPager(200));
  const beforePrepend = vi.fn();
  show({
    owned: true,
    beforePrepend,
    viewportElement: { current: null },
    isFollowing: () => false,
    beginInteraction: () => () => undefined,
  });
  fireEvent.click(screen.getByTestId('chat-agent-earlier-agent'));
  await screen.findByText('m0');
  expect(beforePrepend).not.toHaveBeenCalled();
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
  const viewport = view.container.querySelector('[data-conversation-scroller]')!;
  fireEvent.wheel(viewport, { deltaY: 10 });
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.wheel(viewport, { deltaY: -10 });
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
