/**
 * Behavior tests for the worktree-switch-offer slice of the chat-thread reducer.
 * Fixed input events, hardcoded expected state — no production logic re-derived.
 */
import { describe, it, expect } from 'vitest';
import type { Chat, WorktreeSwitchOffer } from '@qlan-ro/mainframe-types';
import { createChatThreadState, reduceChatThreadState } from '../chat-thread-state';

const CHAT_ID = 'chat-abc';

const OFFER_ALPHA: WorktreeSwitchOffer = {
  chatId: CHAT_ID,
  worktreePath: '/wt/alpha',
  branchName: 'alpha',
  detectedAt: 1_000,
};

/** Same path as OFFER_ALPHA (same identity), different branch + timestamp. */
const OFFER_ALPHA_REDETECTED: WorktreeSwitchOffer = {
  chatId: CHAT_ID,
  worktreePath: '/wt/alpha',
  branchName: 'alpha-v2',
  detectedAt: 3_000,
};

const OFFER_BETA: WorktreeSwitchOffer = {
  chatId: CHAT_ID,
  worktreePath: '/wt/beta',
  branchName: null,
  detectedAt: 2_000,
};

// Composer-relevant fields only; `sameComposerConfig` reads worktreePath/branchName.
const CHAT_ON_MAIN = {
  id: CHAT_ID,
  adapterId: 'claude',
  model: 'opus',
  planMode: false,
  permissionMode: 'default',
  worktreePath: '/repo',
  branchName: 'main',
} as unknown as Chat;

const CHAT_ON_ALPHA = {
  id: CHAT_ID,
  adapterId: 'claude',
  model: 'opus',
  planMode: false,
  permissionMode: 'default',
  worktreePath: '/wt/alpha',
  branchName: 'alpha',
} as unknown as Chat;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('createChatThreadState — worktree-offer initial values', () => {
  it('seeds worktreeOffers empty', () => {
    expect(createChatThreadState(CHAT_ID).worktreeOffers).toEqual({});
  });

  it('seeds switching as null', () => {
    expect(createChatThreadState(CHAT_ID).switching).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// worktree.offer.added / removed / snapshot
// ---------------------------------------------------------------------------

describe('reduceChatThreadState — worktree.offer.added', () => {
  it('inserts the offer keyed by worktreePath', () => {
    const s0 = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s0, { type: 'worktree.offer.added', offer: OFFER_ALPHA });

    expect(s1.worktreeOffers).toEqual({
      '/wt/alpha': { chatId: 'chat-abc', worktreePath: '/wt/alpha', branchName: 'alpha', detectedAt: 1_000 },
    });
  });

  it('keeps offers for different paths side by side', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'worktree.offer.added', offer: OFFER_ALPHA });
    s = reduceChatThreadState(s, { type: 'worktree.offer.added', offer: OFFER_BETA });

    expect(s.worktreeOffers).toEqual({
      '/wt/alpha': { chatId: 'chat-abc', worktreePath: '/wt/alpha', branchName: 'alpha', detectedAt: 1_000 },
      '/wt/beta': { chatId: 'chat-abc', worktreePath: '/wt/beta', branchName: null, detectedAt: 2_000 },
    });
  });

  it('a second add for the same worktreePath replaces the earlier offer', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'worktree.offer.added', offer: OFFER_ALPHA });
    s = reduceChatThreadState(s, { type: 'worktree.offer.added', offer: OFFER_ALPHA_REDETECTED });

    expect(Object.keys(s.worktreeOffers)).toEqual(['/wt/alpha']);
    expect(s.worktreeOffers).toEqual({
      '/wt/alpha': { chatId: 'chat-abc', worktreePath: '/wt/alpha', branchName: 'alpha-v2', detectedAt: 3_000 },
    });
  });
});

describe('reduceChatThreadState — worktree.offer.removed', () => {
  it('deletes the offer at that path and leaves the others', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'worktree.offer.added', offer: OFFER_ALPHA });
    s = reduceChatThreadState(s, { type: 'worktree.offer.added', offer: OFFER_BETA });
    s = reduceChatThreadState(s, { type: 'worktree.offer.removed', worktreePath: '/wt/alpha' });

    expect(s.worktreeOffers).toEqual({
      '/wt/beta': { chatId: 'chat-abc', worktreePath: '/wt/beta', branchName: null, detectedAt: 2_000 },
    });
  });

  it('removing an absent path returns the same state object', () => {
    const s0 = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s0, { type: 'worktree.offer.removed', worktreePath: '/wt/ghost' });

    expect(s1).toBe(s0);
  });
});

describe('reduceChatThreadState — worktree.offer.snapshot', () => {
  it('replaces the whole set', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'worktree.offer.added', offer: OFFER_ALPHA });
    s = reduceChatThreadState(s, { type: 'worktree.offer.snapshot', offers: [OFFER_BETA] });

    expect(s.worktreeOffers).toEqual({
      '/wt/beta': { chatId: 'chat-abc', worktreePath: '/wt/beta', branchName: null, detectedAt: 2_000 },
    });
  });

  it('an empty snapshot clears the slice', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'worktree.offer.added', offer: OFFER_ALPHA });
    s = reduceChatThreadState(s, { type: 'worktree.offer.snapshot', offers: [] });

    expect(s.worktreeOffers).toEqual({});
  });

  it('a snapshot listing exactly what state already holds returns the same state object', () => {
    const seeded = reduceChatThreadState(createChatThreadState(CHAT_ID), {
      type: 'worktree.offer.snapshot',
      offers: [OFFER_ALPHA, OFFER_BETA],
    });
    const resent = reduceChatThreadState(seeded, {
      type: 'worktree.offer.snapshot',
      offers: [
        { chatId: CHAT_ID, worktreePath: '/wt/alpha', branchName: 'alpha', detectedAt: 1_000 },
        { chatId: CHAT_ID, worktreePath: '/wt/beta', branchName: null, detectedAt: 2_000 },
      ],
    });

    expect(resent.worktreeOffers).toEqual({
      '/wt/alpha': { chatId: 'chat-abc', worktreePath: '/wt/alpha', branchName: 'alpha', detectedAt: 1_000 },
      '/wt/beta': { chatId: 'chat-abc', worktreePath: '/wt/beta', branchName: null, detectedAt: 2_000 },
    });
    expect(resent).toBe(seeded);
  });
});

// ---------------------------------------------------------------------------
// worktree.switch.* + the chat.config.updated settle
// ---------------------------------------------------------------------------

describe('reduceChatThreadState — worktree.switch lifecycle', () => {
  it('worktree.switch.started marks the target as restarting', () => {
    const s0 = createChatThreadState(CHAT_ID);
    const s1 = reduceChatThreadState(s0, { type: 'worktree.switch.started', worktreePath: '/wt/alpha' });

    expect(s1.switching).toEqual({ worktreePath: '/wt/alpha', phase: 'restarting' });
  });

  it('chat.config.updated for the in-flight target settles the switch and adopts the config', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'chat.config.updated', chat: CHAT_ON_MAIN });
    s = reduceChatThreadState(s, { type: 'worktree.switch.started', worktreePath: '/wt/alpha' });
    const before = s;
    const after = reduceChatThreadState(before, { type: 'chat.config.updated', chat: CHAT_ON_ALPHA });

    expect(after.switching).toEqual({ worktreePath: '/wt/alpha', phase: 'settled' });
    expect(after.chatConfig).toBe(CHAT_ON_ALPHA);
    expect(after).not.toBe(before);
  });

  it('settles even when the incoming chat is composer-identical (phase is the only change)', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'chat.config.updated', chat: CHAT_ON_ALPHA });
    s = reduceChatThreadState(s, { type: 'worktree.switch.started', worktreePath: '/wt/alpha' });
    const before = s;
    const after = reduceChatThreadState(before, {
      type: 'chat.config.updated',
      chat: {
        id: CHAT_ID,
        adapterId: 'claude',
        model: 'opus',
        planMode: false,
        permissionMode: 'default',
        worktreePath: '/wt/alpha',
        branchName: 'alpha',
      } as unknown as Chat,
    });

    expect(after.switching).toEqual({ worktreePath: '/wt/alpha', phase: 'settled' });
    expect(after).not.toBe(before);
  });

  it('chat.config.updated for an unrelated worktree leaves switching untouched', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'chat.config.updated', chat: CHAT_ON_MAIN });
    s = reduceChatThreadState(s, { type: 'worktree.switch.started', worktreePath: '/wt/alpha' });
    s = reduceChatThreadState(s, {
      type: 'chat.config.updated',
      chat: {
        id: CHAT_ID,
        adapterId: 'claude',
        model: 'opus',
        planMode: false,
        permissionMode: 'default',
        worktreePath: '/wt/gamma',
        branchName: 'gamma',
      } as unknown as Chat,
    });

    expect(s.switching).toEqual({ worktreePath: '/wt/alpha', phase: 'restarting' });
  });

  it('worktree.switch.failed clears switching', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'worktree.switch.started', worktreePath: '/wt/alpha' });
    s = reduceChatThreadState(s, { type: 'worktree.switch.failed' });

    expect(s.switching).toBeNull();
  });

  it('worktree.switch.cleared clears switching', () => {
    let s = createChatThreadState(CHAT_ID);
    s = reduceChatThreadState(s, { type: 'worktree.switch.started', worktreePath: '/wt/alpha' });
    s = reduceChatThreadState(s, { type: 'worktree.switch.cleared' });

    expect(s.switching).toBeNull();
  });
});
