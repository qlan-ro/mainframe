/**
 * QueuedRows (C10) — the queue as rows at the top of the card. Rows the agent
 * still holds say "Queued"; rows a Stop took back are held: the first one says
 * "Not sent: the session stopped." with Send now, later ones just "Waiting".
 * Steered messages are in the transcript, not here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';

let mockTranscriptIds: string[] = [];
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (s: { thread: { messages: { id: string }[] } }) => unknown) =>
    select({ thread: { messages: mockTranscriptIds.map((id) => ({ id })) } }),
}));

const cancelQueued = vi.fn().mockResolvedValue(undefined);
const editQueued = vi.fn().mockResolvedValue(undefined);
const sendHeld = vi.fn().mockResolvedValue(undefined);
const resumeQueuedMessages = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/api/chats', () => ({ resumeQueuedMessages }));
let mockQueued: Record<string, QueuedMessageRef> = {};
vi.mock('../../../runtime/chat-extras', () => ({
  useChatExtras: () => ({
    queued: mockQueued,
    port: 4200,
    state: { chatId: 'chat-1' },
    cancelQueued,
    editQueued,
    sendHeld,
  }),
}));

const startEdit = vi.fn();
vi.mock('../../edit/composer-edit-context', () => ({ useComposerEdit: () => ({ startEdit }) }));
vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn() } }));
vi.mock('../../focus-composer', () => ({ focusVisibleComposer: vi.fn() }));

import { mfToast } from '@/lib/toast';
import { focusVisibleComposer } from '../../focus-composer';
import { CLAIM_MS, useHeldQueue } from '../held-queue-store';
import { QueuedRows } from '../QueuedRows';

const ref = (id: string, second: number, overrides: Partial<QueuedMessageRef> = {}): QueuedMessageRef => ({
  messageId: id,
  chatId: 'chat-1',
  uuid: `u-${id}`,
  content: `text ${id}`,
  timestamp: `2026-11-24T10:00:0${second}.000Z`,
  ...overrides,
});

const queue = (...refs: QueuedMessageRef[]) => Object.fromEntries(refs.map((r) => [r.messageId, r]));
const renderRows = () =>
  render(
    <TooltipProvider>
      <QueuedRows />
    </TooltipProvider>,
  );
const rows = () => screen.getAllByTestId('chat-queued-message');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useHeldQueue.setState({ byChat: {} });
  mockQueued = {};
  mockTranscriptIds = [];
});

describe('QueuedRows — queued rows', () => {
  it('renders nothing with an empty queue', () => {
    const { container } = renderRows();

    expect(container).toBeEmptyDOMElement();
  });

  it('lists queued messages oldest first, each labelled "Queued"', () => {
    mockQueued = queue(ref('m2', 2), ref('m1', 1));

    renderRows();

    expect(rows().map((row) => row.dataset.queuedId)).toEqual(['m1', 'm2']);
    expect(rows()[0]).toHaveTextContent('Queuedtext m1');
    expect(screen.getByRole('list', { name: 'Queued messages' })).toBeInTheDocument();
  });

  it('shows the pause reason and one Resume action alongside edit and remove', () => {
    mockQueued = queue(ref('m1', 1, { pauseReason: 'Stopped' }), ref('m2', 2, { pauseReason: 'Stopped' }));
    renderRows();

    expect(screen.getAllByText('Paused · Stopped')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Edit queued message' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Remove queued message' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(resumeQueuedMessages).toHaveBeenCalledExactlyOnceWith(4200, 'chat-1');
  });

  it('shows the attachment count after the text', () => {
    mockQueued = queue(ref('m1', 1, { attachmentIds: ['a', 'b'] }));

    renderRows();

    expect(screen.getByTestId('chat-queued-bubble')).toHaveTextContent('text m1 · 2 files');
  });

  it('says "1 file" for one attachment', () => {
    mockQueued = queue(ref('m1', 1, { attachmentIds: ['a'] }));

    renderRows();

    expect(screen.getByTestId('chat-queued-bubble')).toHaveTextContent('text m1 · 1 file');
  });

  it('leaves out a steered message: it is in the transcript', () => {
    mockQueued = queue(ref('m1', 1, { steered: true }), ref('m2', 2));

    renderRows();

    expect(rows().map((row) => row.dataset.queuedId)).toEqual(['m2']);
  });

  it('renders nothing when the only message is steered', () => {
    mockQueued = queue(ref('m1', 1, { steered: true }));

    const { container } = renderRows();

    expect(container).toBeEmptyDOMElement();
  });

  it('removes a queued message through the daemon', () => {
    mockQueued = queue(ref('m1', 1));
    renderRows();

    fireEvent.click(screen.getByTestId('chat-queued-cancel'));

    expect(cancelQueued).toHaveBeenCalledExactlyOnceWith('m1');
  });

  it('edits a queued message in the composer', () => {
    mockQueued = queue(ref('m1', 1));
    renderRows();

    fireEvent.click(screen.getByTestId('chat-queued-edit'));

    expect(startEdit).toHaveBeenCalledExactlyOnceWith({ messageId: 'm1', content: 'text m1' });
  });

  it('shows a rejected message as failed with Retry, and no edit', () => {
    mockQueued = queue(ref('m1', 1, { delivery: 'rejected' }));
    renderRows();

    expect(rows()[0]).toHaveTextContent('Not sent: the agent refused it. The queue is paused.');
    expect(screen.queryByTestId('chat-queued-edit')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-queued-retry'));
    expect(editQueued).toHaveBeenCalledExactlyOnceWith('m1', 'text m1');
  });

  it('shows an unconfirmed delivery as uncertain, with no Retry', () => {
    mockQueued = queue(ref('m1', 1, { delivery: 'unconfirmed' }));
    renderRows();

    expect(rows()[0]).toHaveTextContent('Delivery uncertain.');
    expect(screen.queryByTestId('chat-queued-retry')).toBeNull();
  });
});

describe('QueuedRows — held rows after a Stop', () => {
  const hold = (id: string, second: number) => useHeldQueue.getState().hold('chat-1', ref(id, second));

  it('puts held rows first; the first says why and offers Send now, the rest just wait', () => {
    hold('h1', 1);
    hold('h2', 2);
    mockQueued = queue(ref('q1', 3));

    renderRows();

    expect(rows().map((row) => row.dataset.queuedId)).toEqual(['h1', 'h2', 'q1']);
    expect(rows()[0]).toHaveTextContent('Not sent: the session stopped.');
    expect(within(rows()[0]!).getByTestId('chat-queued-send-now')).toHaveTextContent('Send now');
    expect(rows()[1]).toHaveTextContent('Waitingtext h2');
    expect(within(rows()[1]!).queryByTestId('chat-queued-send-now')).toBeNull();
    expect(within(rows()[2]!).getByText('Queued')).toBeInTheDocument();
  });

  it('Send now sends the held row through the session', () => {
    hold('h1', 1);
    renderRows();

    fireEvent.click(screen.getByTestId('chat-queued-send-now'));

    expect(sendHeld).toHaveBeenCalledExactlyOnceWith('h1');
    expect(focusVisibleComposer).toHaveBeenCalledOnce();
  });

  it('removing a held row drops it from the store', () => {
    hold('h1', 1);
    renderRows();

    fireEvent.click(screen.getByTestId('chat-queued-cancel'));

    expect(useHeldQueue.getState().byChat).toEqual({});
  });

  it('editing a held row saves into the held store', async () => {
    hold('h1', 1);
    renderRows();

    fireEvent.click(screen.getByTestId('chat-queued-edit'));

    const [edit] = startEdit.mock.calls[0] as [
      { messageId: string; content: string; save: (next: string) => Promise<void> },
    ];
    expect(edit).toMatchObject({ messageId: 'h1', content: 'text h1' });
    await edit.save('reworded');
    expect(useHeldQueue.getState().byChat['chat-1']![0]!.content).toBe('reworded');
  });

  it('hides a held row the agent already picked up (it is in the transcript)', () => {
    hold('h1', 1);
    hold('h2', 2);
    mockTranscriptIds = ['h1'];

    renderRows();

    expect(rows().map((row) => row.dataset.queuedId)).toEqual(['h2']);
    expect(rows()[0]).toHaveTextContent('Not sent: the session stopped.');
    // Forgotten, not just hidden.
    expect(useHeldQueue.getState().byChat['chat-1']!.map((row) => row.messageId)).toEqual(['h2']);
  });

  it('hides a held row while its id is still in the live queue, so it never shows twice', () => {
    hold('h1', 1);
    mockQueued = queue(ref('h1', 1));

    renderRows();

    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByText('Queued')).toBeInTheDocument();
  });

  it('shows a row on its way, and nothing to press on it or behind it', () => {
    hold('h1', 1);
    hold('h2', 2);
    useHeldQueue.getState().claimFrom('chat-1', 'h1', 'p1');
    useHeldQueue.getState().startSending('chat-1', 'h1', 'p1');

    renderRows();

    expect(rows()[0]).toHaveTextContent('Sending…text h1');
    expect(rows()[0]).toHaveAttribute('data-sending');
    expect(within(rows()[0]!).getByRole('status')).toHaveTextContent('Sending…');
    expect(rows()[1]).toHaveTextContent('Waitingtext h2');
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('what "Send now" has not sent yet stands behind what the agent already has', () => {
    hold('h3', 3);
    useHeldQueue.getState().claimFrom('chat-1', 'h3', 'p1');
    mockQueued = queue(ref('b', 9));

    renderRows();

    expect(rows().map((row) => row.dataset.queuedId)).toEqual(['b', 'h3']);
  });

  it('offers no second send while a row behind is on its way', () => {
    hold('h1', 1);
    hold('h2', 2);
    useHeldQueue.getState().claimFrom('chat-1', 'h2', 'p1');

    renderRows();

    expect(rows()[0]).toHaveTextContent('Not sent: the session stopped.');
    expect(screen.queryByTestId('chat-queued-send-now')).toBeNull();
  });

  it('a row that may have gone out says so and offers to send it again', () => {
    hold('h1', 1);
    useHeldQueue.getState().claimFrom('chat-1', 'h1', 'p1');
    useHeldQueue.getState().startSending('chat-1', 'h1', 'p1');
    useHeldQueue.getState().releaseClaims();

    renderRows();

    expect(rows()[0]).toHaveTextContent('It may already have reached the agent.');
    expect(screen.getByTestId('chat-queued-send-now')).toHaveTextContent('Send again');
    expect(screen.getByTestId('chat-queued-cancel')).toBeInTheDocument();
  });

  it('a row the daemon refused says why, offers Send now, and not that it may have arrived', () => {
    hold('h1', 1);
    useHeldQueue.getState().claimFrom('chat-1', 'h1', 'p1');
    useHeldQueue.getState().startSending('chat-1', 'h1', 'p1');
    useHeldQueue.getState().refuse('chat-1', 'h1', 'p1', 'the session is not running.');

    renderRows();

    expect(rows()[0]).toHaveTextContent('Not sent: the session is not running.');
    expect(rows()[0]).not.toHaveTextContent('may already have reached');
    expect(screen.getByTestId('chat-queued-send-now')).toHaveTextContent('Send now');
  });

  it('a refused send says why in the toast too', async () => {
    sendHeld.mockRejectedValueOnce({
      code: -32002,
      message: 'session unavailable: Chat chat-1 not running',
      data: { '_mainframe.dev': { reason: 'Chat chat-1 not running', neverDelivered: true } },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hold('h1', 1);
    renderRows();

    fireEvent.click(screen.getByTestId('chat-queued-send-now'));
    await act(async () => {});

    expect(mfToast.error).toHaveBeenCalledExactlyOnceWith('Could not send the queued message', {
      description: 'the session is not running.',
    });
  });

  it('a claim left by a window that is gone runs out on its own', () => {
    vi.useFakeTimers();
    try {
      hold('h1', 1);
      useHeldQueue.getState().claimFrom('chat-1', 'h1', 'p1');
      useHeldQueue.getState().startSending('chat-1', 'h1', 'p1');
      renderRows();
      expect(rows()[0]).toHaveAttribute('data-sending');

      act(() => vi.advanceTimersByTime(CLAIM_MS));

      expect(rows()[0]).not.toHaveAttribute('data-sending');
      expect(screen.getByTestId('chat-queued-send-now')).toHaveTextContent('Send again');
    } finally {
      vi.useRealTimers();
    }
  });

  it('an edit saved while the row is sent fails, so its text is not lost', async () => {
    hold('h1', 1);
    renderRows();
    fireEvent.click(screen.getByTestId('chat-queued-edit'));
    const [edit] = startEdit.mock.calls[0] as [{ save: (next: string) => Promise<void> }];
    act(() => void useHeldQueue.getState().claimFrom('chat-1', 'h1', 'p1'));

    await expect(edit.save('reworded')).rejects.toThrow('being sent');
  });
});
