import { describe, it, expect, afterEach } from 'vitest';
import {
  useArchivePrompt,
  requestWorktreeArchiveChoice,
  stageArchiveChoice,
  takeArchiveChoice,
} from '../archive-confirm-bridge';

// ---------------------------------------------------------------------------
// Reset zustand state between tests (the store is a module-level singleton)
// ---------------------------------------------------------------------------

afterEach(() => {
  useArchivePrompt.setState({ pending: null });
  // Drain any staged choices left behind by a test so they don't leak.
  takeArchiveChoice('chat-1');
  takeArchiveChoice('chat-2');
});

// ---------------------------------------------------------------------------
// archive-confirm-bridge — request/resolve (the ASK)
// ---------------------------------------------------------------------------

describe('archive-confirm-bridge — initial state has no pending request', () => {
  it('pending is null before any request is made', () => {
    expect(useArchivePrompt.getState().pending).toBeNull();
  });
});

describe('archive-confirm-bridge — request sets pending with the remoteId', () => {
  it('sets pending to { remoteId: "chat-1" }', () => {
    void requestWorktreeArchiveChoice('chat-1');
    expect(useArchivePrompt.getState().pending).toEqual({ remoteId: 'chat-1' });
  });
});

describe('archive-confirm-bridge — resolve with deleteWorktree:true fulfills the promise and clears pending', () => {
  it('awaited promise yields { deleteWorktree:true } and pending becomes null', async () => {
    const promise = requestWorktreeArchiveChoice('chat-1');

    useArchivePrompt.getState().resolve({ deleteWorktree: true });

    const result = await promise;
    expect(result).toEqual({ deleteWorktree: true });
    expect(useArchivePrompt.getState().pending).toBeNull();
  });
});

describe('archive-confirm-bridge — resolve with deleteWorktree:false fulfills the promise', () => {
  it('awaited promise yields { deleteWorktree:false }', async () => {
    const promise = requestWorktreeArchiveChoice('chat-1');

    useArchivePrompt.getState().resolve({ deleteWorktree: false });

    const result = await promise;
    expect(result).toEqual({ deleteWorktree: false });
  });
});

describe('archive-confirm-bridge — cancel: resolve with cancel fulfills the promise and clears pending', () => {
  it('awaited promise yields "cancel" and pending becomes null', async () => {
    const promise = requestWorktreeArchiveChoice('chat-2');

    useArchivePrompt.getState().resolve('cancel');

    const result = await promise;
    expect(result).toBe('cancel');
    expect(useArchivePrompt.getState().pending).toBeNull();
  });
});

describe('archive-confirm-bridge — resolve with no pending is a no-op', () => {
  it('does not throw when resolve is called with nothing pending', () => {
    expect(useArchivePrompt.getState().pending).toBeNull();
    expect(() => useArchivePrompt.getState().resolve({ deleteWorktree: true })).not.toThrow();
  });
});

describe('archive-confirm-bridge — second request while first is pending overwrites pending (one prompt at a time)', () => {
  it('pending reflects the most-recent request after two overlapping requests', () => {
    void requestWorktreeArchiveChoice('chat-1');
    void requestWorktreeArchiveChoice('chat-2');

    expect(useArchivePrompt.getState().pending).toEqual({ remoteId: 'chat-2' });
  });

  it('resolving after the second request fulfills the second promise', async () => {
    void requestWorktreeArchiveChoice('chat-1');
    const second = requestWorktreeArchiveChoice('chat-2');

    useArchivePrompt.getState().resolve({ deleteWorktree: false });

    const result = await second;
    expect(result).toEqual({ deleteWorktree: false });
    expect(useArchivePrompt.getState().pending).toBeNull();
  });

  it('resolves the displaced first promise with "cancel" (no stranded promise)', async () => {
    const first = requestWorktreeArchiveChoice('chat-1');
    const second = requestWorktreeArchiveChoice('chat-2');

    // The first promise must settle on its own — a second request strands it
    // otherwise. It resolves to 'cancel' so its caller abandons that archive.
    await expect(first).resolves.toBe('cancel');

    useArchivePrompt.getState().resolve({ deleteWorktree: false });
    await expect(second).resolves.toEqual({ deleteWorktree: false });
  });
});

// ---------------------------------------------------------------------------
// archive-confirm-bridge — stageArchiveChoice / takeArchiveChoice (the HANDOFF)
// ---------------------------------------------------------------------------

describe('archive-confirm-bridge — takeArchiveChoice with nothing staged', () => {
  it('returns undefined when no choice was staged for that remoteId', () => {
    expect(takeArchiveChoice('chat-1')).toBeUndefined();
  });
});

describe('archive-confirm-bridge — stageArchiveChoice then takeArchiveChoice hands off the staged value', () => {
  it('returns { deleteWorktree: true } after staging it for chat-1', () => {
    stageArchiveChoice('chat-1', { deleteWorktree: true });
    expect(takeArchiveChoice('chat-1')).toEqual({ deleteWorktree: true });
  });

  it('returns { deleteWorktree: false } after staging it for chat-1', () => {
    stageArchiveChoice('chat-1', { deleteWorktree: false });
    expect(takeArchiveChoice('chat-1')).toEqual({ deleteWorktree: false });
  });
});

describe('archive-confirm-bridge — takeArchiveChoice consumes the staged value', () => {
  it('returns undefined on a second take for the same remoteId', () => {
    stageArchiveChoice('chat-1', { deleteWorktree: true });
    takeArchiveChoice('chat-1');
    expect(takeArchiveChoice('chat-1')).toBeUndefined();
  });
});

describe('archive-confirm-bridge — staged choices are keyed per remoteId', () => {
  it('taking chat-2 does not consume or return chat-1s staged choice', () => {
    stageArchiveChoice('chat-1', { deleteWorktree: true });
    stageArchiveChoice('chat-2', { deleteWorktree: false });

    expect(takeArchiveChoice('chat-2')).toEqual({ deleteWorktree: false });
    expect(takeArchiveChoice('chat-1')).toEqual({ deleteWorktree: true });
  });
});
