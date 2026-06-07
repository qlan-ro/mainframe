import { describe, it, expect, afterEach } from 'vitest';
import { useArchivePrompt, requestWorktreeArchiveChoice } from '../archive-confirm-bridge';

// ---------------------------------------------------------------------------
// Reset zustand state between tests (the store is a module-level singleton)
// ---------------------------------------------------------------------------

afterEach(() => {
  useArchivePrompt.setState({ pending: null });
});

// ---------------------------------------------------------------------------
// archive-confirm-bridge
// ---------------------------------------------------------------------------

describe('archive-confirm-bridge — initial state has no pending request', () => {
  it('pending is null before any request is made', () => {
    expect(useArchivePrompt.getState().pending).toBeNull();
  });
});

describe('archive-confirm-bridge — request sets pending with provided fields', () => {
  it('sets pending to { remoteId, hasWorktree } matching the call arguments', () => {
    void requestWorktreeArchiveChoice('chat-1', { hasWorktree: true });
    expect(useArchivePrompt.getState().pending).toEqual({
      remoteId: 'chat-1',
      hasWorktree: true,
    });
  });
});

describe('archive-confirm-bridge — resolve with deleteWorktree:true fulfills the promise and clears pending', () => {
  it('awaited promise yields { deleteWorktree:true } and pending becomes null', async () => {
    const promise = requestWorktreeArchiveChoice('chat-1', { hasWorktree: true });

    useArchivePrompt.getState().resolve({ deleteWorktree: true });

    const result = await promise;
    expect(result).toEqual({ deleteWorktree: true });
    expect(useArchivePrompt.getState().pending).toBeNull();
  });
});

describe('archive-confirm-bridge — resolve with deleteWorktree:false fulfills the promise', () => {
  it('awaited promise yields { deleteWorktree:false }', async () => {
    const promise = requestWorktreeArchiveChoice('chat-1', { hasWorktree: true });

    useArchivePrompt.getState().resolve({ deleteWorktree: false });

    const result = await promise;
    expect(result).toEqual({ deleteWorktree: false });
  });
});

describe('archive-confirm-bridge — cancel: resolve with cancel fulfills the promise and clears pending', () => {
  it('awaited promise yields "cancel" and pending becomes null', async () => {
    const promise = requestWorktreeArchiveChoice('chat-2', { hasWorktree: false });

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
    void requestWorktreeArchiveChoice('chat-1', { hasWorktree: true });
    void requestWorktreeArchiveChoice('chat-2', { hasWorktree: false });

    expect(useArchivePrompt.getState().pending).toEqual({
      remoteId: 'chat-2',
      hasWorktree: false,
    });
  });

  it('resolving after the second request fulfills the second promise', async () => {
    void requestWorktreeArchiveChoice('chat-1', { hasWorktree: true });
    const second = requestWorktreeArchiveChoice('chat-2', { hasWorktree: false });

    useArchivePrompt.getState().resolve({ deleteWorktree: false });

    const result = await second;
    expect(result).toEqual({ deleteWorktree: false });
    expect(useArchivePrompt.getState().pending).toBeNull();
  });

  it('resolves the displaced first promise with "cancel" (no stranded promise)', async () => {
    const first = requestWorktreeArchiveChoice('chat-1', { hasWorktree: true });
    const second = requestWorktreeArchiveChoice('chat-2', { hasWorktree: false });

    // The first promise must settle on its own — a second request strands it
    // otherwise. It resolves to 'cancel' so its adapter.archive rolls back.
    await expect(first).resolves.toBe('cancel');

    useArchivePrompt.getState().resolve({ deleteWorktree: false });
    await expect(second).resolves.toEqual({ deleteWorktree: false });
  });
});
