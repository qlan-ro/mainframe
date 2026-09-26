/**
 * ghost-chat-queue — behavior tests (todo #346: a persistent set reconciled by the consumer, not a notify-drain
 * queue).
 *
 * new-thread-coordinator (aui-free) marks a discarded chat here;
 * useGhostChatPrune (aui-aware) reconciles it against the live list. These
 * tests cover just the set's own contract.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { markChatDiscarded, getDiscardedChatIds, clearDiscardedChatId } from '../ghost-chat-queue';

afterEach(() => {
  for (const id of getDiscardedChatIds()) clearDiscardedChatId(id); // drain any leftovers between tests
});

describe('ghost-chat-queue', () => {
  it('is empty when nothing was marked', () => {
    expect(getDiscardedChatIds().size).toBe(0);
  });

  it('contains the marked id after markChatDiscarded', () => {
    markChatDiscarded('chat-1');
    expect([...getDiscardedChatIds()]).toEqual(['chat-1']);
  });

  it('contains every id marked, in order, until cleared', () => {
    markChatDiscarded('chat-1');
    markChatDiscarded('chat-2');
    expect([...getDiscardedChatIds()]).toEqual(['chat-1', 'chat-2']);
  });

  it('marking the same id twice does not duplicate it', () => {
    markChatDiscarded('chat-1');
    markChatDiscarded('chat-1');
    expect([...getDiscardedChatIds()]).toEqual(['chat-1']);
  });

  it('clearDiscardedChatId removes only the named id', () => {
    markChatDiscarded('chat-1');
    markChatDiscarded('chat-2');
    clearDiscardedChatId('chat-1');
    expect([...getDiscardedChatIds()]).toEqual(['chat-2']);
  });

  it('an id not yet cleared survives across repeated reads (not a one-shot drain)', () => {
    markChatDiscarded('chat-1');
    expect([...getDiscardedChatIds()]).toEqual(['chat-1']);
    expect([...getDiscardedChatIds()]).toEqual(['chat-1']); // still there — no implicit drain
  });
});
