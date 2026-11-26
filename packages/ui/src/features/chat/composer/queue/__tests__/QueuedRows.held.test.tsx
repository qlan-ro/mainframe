import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { CLAIM_MS, useHeldQueue } from '../held-queue-store';
import {
  focusVisibleComposer,
  mockChat,
  pinToBottom,
  queue,
  ref,
  renderRows,
  rows,
  sendHeld,
  startEdit,
  toastError,
} from './queued-rows-test-harness';

describe('QueuedRows — held rows after a Stop', () => {
  const hold = (id: string, second: number) => useHeldQueue.getState().hold('chat-1', ref(id, second));

  it('puts held rows first; the first says why and offers Send now, the rest just wait', () => {
    hold('h1', 1);
    hold('h2', 2);
    mockChat.queued = queue(ref('q1', 3));

    renderRows();

    expect(rows().map((row) => row.dataset.queuedId)).toEqual(['h1', 'h2', 'q1']);
    expect(rows()[0]).toHaveTextContent('Not sent: the session stopped.');
    expect(within(rows()[0]!).getByTestId('chat-queued-send-now')).toHaveTextContent('Send now');
    expect(rows()[1]).toHaveTextContent('Waitingtext h2');
    expect(within(rows()[1]!).queryByTestId('chat-queued-send-now')).toBeNull();
    expect(within(rows()[2]!).getByText('Queued')).toBeInTheDocument();
  });

  it('Send now sends the held row through the session and re-pins the transcript', () => {
    hold('h1', 1);
    renderRows();

    fireEvent.click(screen.getByTestId('chat-queued-send-now'));

    expect(sendHeld).toHaveBeenCalledExactlyOnceWith('h1');
    expect(focusVisibleComposer).toHaveBeenCalledOnce();
    expect(pinToBottom).toHaveBeenCalledOnce();
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
    mockChat.transcriptIds = ['h1'];

    renderRows();

    expect(rows().map((row) => row.dataset.queuedId)).toEqual(['h2']);
    expect(rows()[0]).toHaveTextContent('Not sent: the session stopped.');
    // Forgotten, not just hidden.
    expect(useHeldQueue.getState().byChat['chat-1']!.map((row) => row.messageId)).toEqual(['h2']);
  });

  it('hides a held row while its id is still in the live queue, so it never shows twice', () => {
    hold('h1', 1);
    mockChat.queued = queue(ref('h1', 1));

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
    mockChat.queued = queue(ref('b', 9));

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

    expect(toastError).toHaveBeenCalledExactlyOnceWith('Could not send the queued message', {
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
