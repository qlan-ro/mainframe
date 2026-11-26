import { describe, it, expect } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  cancelQueued,
  cancelQueuedMessage,
  composer,
  editQueued,
  mockChat,
  queue,
  ref,
  renderRows,
  confirmQueuedMessage,
  resumeQueuedMessages,
  rows,
  startEdit,
} from './queued-rows-test-harness';
import { QueuedRows } from '../QueuedRows';

describe('QueuedRows — queued rows', () => {
  it('renders nothing with an empty queue', () => {
    const { container } = renderRows();

    expect(container).toBeEmptyDOMElement();
  });

  it('lists queued messages oldest first, each labelled "Queued"', () => {
    mockChat.queued = queue(ref('m2', 2), ref('m1', 1));

    renderRows();

    expect(rows().map((row) => row.dataset.queuedId)).toEqual(['m1', 'm2']);
    expect(rows()[0]).toHaveTextContent('Queuedtext m1');
    expect(screen.getByRole('list', { name: 'Queued messages' })).toBeInTheDocument();
  });

  it('shows the pause reason and one Resume action alongside edit and remove', () => {
    mockChat.queued = queue(ref('m1', 1, { pauseReason: 'Stopped' }), ref('m2', 2, { pauseReason: 'Stopped' }));
    renderRows();

    expect(screen.getAllByText('Paused · Stopped')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Edit queued message' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Remove queued message' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(resumeQueuedMessages).toHaveBeenCalledExactlyOnceWith(4200, 'chat-1');
  });

  it('shows the attachment count after the text', () => {
    mockChat.queued = queue(ref('m1', 1, { attachmentIds: ['a', 'b'] }));

    renderRows();

    expect(screen.getByTestId('chat-queued-bubble')).toHaveTextContent('text m1 · 2 files');
  });

  it('says "1 file" for one attachment', () => {
    mockChat.queued = queue(ref('m1', 1, { attachmentIds: ['a'] }));

    renderRows();

    expect(screen.getByTestId('chat-queued-bubble')).toHaveTextContent('text m1 · 1 file');
  });

  it('leaves out a steered message: it is in the transcript', () => {
    mockChat.queued = queue(ref('m1', 1, { steered: true }), ref('m2', 2));

    renderRows();

    expect(rows().map((row) => row.dataset.queuedId)).toEqual(['m2']);
  });

  it('renders nothing when the only message is steered', () => {
    mockChat.queued = queue(ref('m1', 1, { steered: true }));

    const { container } = renderRows();

    expect(container).toBeEmptyDOMElement();
  });

  it('removes a queued message through the daemon', () => {
    mockChat.queued = queue(ref('m1', 1));
    renderRows();

    fireEvent.click(screen.getByTestId('chat-queued-cancel'));

    expect(cancelQueued).toHaveBeenCalledExactlyOnceWith('m1');
  });

  it('edits a queued message in the composer', () => {
    mockChat.queued = queue(ref('m1', 1));
    renderRows();

    fireEvent.click(screen.getByTestId('chat-queued-edit'));

    expect(startEdit).toHaveBeenCalledExactlyOnceWith({ messageId: 'm1', content: 'text m1' });
  });

  it('shows a rejected message as failed with Retry, and no edit', () => {
    mockChat.queued = queue(ref('m1', 1, { delivery: 'rejected', pauseReason: 'Stopped' }));
    renderRows();

    expect(rows()[0]).toHaveTextContent('Not sent: the agent refused it. The queue is paused.');
    expect(screen.queryByTestId('chat-queued-edit')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    fireEvent.click(screen.getByTestId('chat-queued-retry'));
    expect(editQueued).toHaveBeenCalledExactlyOnceWith('m1', 'text m1');
  });

  it('shows recovery actions in place of Resume while the head is uncertain', async () => {
    mockChat.queued = queue(
      ref('m1', 1, { delivery: 'unconfirmed', pauseReason: 'Session ended' }),
      ref('m2', 2, { pauseReason: 'Session ended' }),
    );
    const view = renderRows();

    expect(rows()[0]).toHaveTextContent('Uncertain');
    expect(rows()[0]).toHaveTextContent('Not confirmed by the agent. It may have been received.');
    expect(rows()[1]).toHaveTextContent('Waiting on the message above');
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    const head = within(screen.getAllByRole('listitem')[0]!);
    expect(head.queryByTestId('chat-queued-edit')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as sent' }));
    expect(confirmQueuedMessage).toHaveBeenCalledExactlyOnceWith(4200, 'chat-1', 'm1');
    fireEvent.click(screen.getByRole('button', { name: 'Move to composer' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(cancelQueuedMessage).toHaveBeenCalledExactlyOnceWith(4200, 'chat-1', 'm1');
    expect(composer.setText).toHaveBeenCalledWith('draft\n\ntext m1');

    mockChat.queued = queue(ref('m2', 2, { pauseReason: 'Session ended' }));
    view.rerender(
      <TooltipProvider>
        <QueuedRows />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });
});
