/**
 * Behavior tests for handleDaemonEvent — worktree.offer.* mapping.
 * Fixed input events, hardcoded expected HandleResults.
 */
import { describe, it, expect } from 'vitest';
import type { WorktreeSwitchOffer } from '@qlan-ro/mainframe-types';
import { handleDaemonEvent } from '../handle-daemon-event';

const CHAT_ID = 'chat-abc';
const OTHER_CHAT = 'chat-other';
const OFFER: WorktreeSwitchOffer = {
  chatId: CHAT_ID,
  worktreePath: '/wt/alpha',
  branchName: 'alpha',
  detectedAt: 1_000,
};

const OFFER_FOR_OTHER_CHAT: WorktreeSwitchOffer = {
  chatId: OTHER_CHAT,
  worktreePath: '/wt/alpha',
  branchName: 'alpha',
  detectedAt: 1_000,
};

describe('handleDaemonEvent — worktree.offer.raised', () => {
  it('maps to worktree.offer.added carrying the offer', () => {
    const result = handleDaemonEvent({ type: 'worktree.offer.raised', chatId: CHAT_ID, offer: OFFER }, CHAT_ID);

    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'worktree.offer.added',
        offer: { chatId: 'chat-abc', worktreePath: '/wt/alpha', branchName: 'alpha', detectedAt: 1_000 },
      },
    });
  });

  it('raised for another chat → noop', () => {
    const result = handleDaemonEvent(
      { type: 'worktree.offer.raised', chatId: OTHER_CHAT, offer: OFFER_FOR_OTHER_CHAT },
      CHAT_ID,
    );

    expect(result).toEqual({ kind: 'noop' });
  });
});

describe('handleDaemonEvent — worktree.offer.resolved', () => {
  it('maps to worktree.offer.removed keyed by worktreePath', () => {
    const result = handleDaemonEvent(
      { type: 'worktree.offer.resolved', chatId: CHAT_ID, worktreePath: '/wt/alpha', outcome: 'dismissed' },
      CHAT_ID,
    );

    expect(result).toEqual({
      kind: 'event',
      event: { type: 'worktree.offer.removed', worktreePath: '/wt/alpha' },
    });
  });

  it('maps an accepted outcome to the same removal', () => {
    const result = handleDaemonEvent(
      { type: 'worktree.offer.resolved', chatId: CHAT_ID, worktreePath: '/wt/beta', outcome: 'accepted' },
      CHAT_ID,
    );

    expect(result).toEqual({
      kind: 'event',
      event: { type: 'worktree.offer.removed', worktreePath: '/wt/beta' },
    });
  });

  it('maps an expired outcome to the same removal', () => {
    const result = handleDaemonEvent(
      { type: 'worktree.offer.resolved', chatId: CHAT_ID, worktreePath: '/wt/beta', outcome: 'expired' },
      CHAT_ID,
    );

    expect(result).toEqual({
      kind: 'event',
      event: { type: 'worktree.offer.removed', worktreePath: '/wt/beta' },
    });
  });

  it('resolved for another chat → noop', () => {
    const result = handleDaemonEvent(
      { type: 'worktree.offer.resolved', chatId: OTHER_CHAT, worktreePath: '/wt/alpha', outcome: 'dismissed' },
      CHAT_ID,
    );

    expect(result).toEqual({ kind: 'noop' });
  });
});

describe('handleDaemonEvent — worktree.offer.snapshot', () => {
  it('maps to worktree.offer.snapshot carrying the offer list', () => {
    const result = handleDaemonEvent({ type: 'worktree.offer.snapshot', chatId: CHAT_ID, offers: [OFFER] }, CHAT_ID);

    expect(result).toEqual({
      kind: 'event',
      event: {
        type: 'worktree.offer.snapshot',
        offers: [{ chatId: 'chat-abc', worktreePath: '/wt/alpha', branchName: 'alpha', detectedAt: 1_000 }],
      },
    });
  });

  it('maps an empty snapshot through unchanged', () => {
    const result = handleDaemonEvent({ type: 'worktree.offer.snapshot', chatId: CHAT_ID, offers: [] }, CHAT_ID);

    expect(result).toEqual({ kind: 'event', event: { type: 'worktree.offer.snapshot', offers: [] } });
  });

  it('snapshot for another chat → noop', () => {
    const result = handleDaemonEvent(
      { type: 'worktree.offer.snapshot', chatId: OTHER_CHAT, offers: [OFFER_FOR_OTHER_CHAT] },
      CHAT_ID,
    );

    expect(result).toEqual({ kind: 'noop' });
  });
});
