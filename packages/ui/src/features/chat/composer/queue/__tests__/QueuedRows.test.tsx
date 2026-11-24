/**
 * QueuedRows (C10) — the queue as rows at the top of the card. Rows the agent
 * still holds say "Queued"; rows a Stop took back are held: the first one says
 * "Not sent: the session stopped." with Send now, later ones just "Waiting".
 * Steered messages are in the transcript, not here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
let mockQueued: Record<string, QueuedMessageRef> = {};
vi.mock('../../../runtime/chat-extras', () => ({
  useChatExtras: () => ({ queued: mockQueued, state: { chatId: 'chat-1' }, cancelQueued, editQueued, sendHeld }),
}));

const startEdit = vi.fn();
vi.mock('../../edit/composer-edit-context', () => ({ useComposerEdit: () => ({ startEdit }) }));
vi.mock('../../focus-composer', () => ({ focusVisibleComposer: vi.fn() }));

import { useHeldQueue } from '../held-queue-store';
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
  });

  it('hides a held row while its id is still in the live queue, so it never shows twice', () => {
    hold('h1', 1);
    mockQueued = queue(ref('h1', 1));

    renderRows();

    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByText('Queued')).toBeInTheDocument();
  });
});
