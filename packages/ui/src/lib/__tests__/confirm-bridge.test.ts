import { describe, it, expect, beforeEach } from 'vitest';
import { useConfirmBridge, requestConfirm } from '../confirm-bridge';

beforeEach(() => {
  useConfirmBridge.setState({ pending: null });
});

describe('confirm-bridge — requestConfirm', () => {
  it('sets pending and returns a promise that stays unsettled', async () => {
    let settled = false;
    const promise = requestConfirm({ title: 'Remove "alpha"?' });
    void promise.then(() => {
      settled = true;
    });

    expect(useConfirmBridge.getState().pending).toEqual({ title: 'Remove "alpha"?' });
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});

describe('confirm-bridge — resolve', () => {
  it('resolve(true) settles the pending promise with true and clears pending', async () => {
    const promise = requestConfirm({ title: 'Remove "alpha"?' });
    useConfirmBridge.getState().resolve(true);

    await expect(promise).resolves.toBe(true);
    expect(useConfirmBridge.getState().pending).toBeNull();
  });

  it('resolve(false) settles the pending promise with false and clears pending', async () => {
    const promise = requestConfirm({ title: 'Remove "alpha"?' });
    useConfirmBridge.getState().resolve(false);

    await expect(promise).resolves.toBe(false);
    expect(useConfirmBridge.getState().pending).toBeNull();
  });
});

describe('confirm-bridge — displacement', () => {
  it('a second requestConfirm resolves the first with false and leaves only the newer request pending', async () => {
    const first = requestConfirm({ title: 'Remove "alpha"?' });
    const second = requestConfirm({ title: 'Remove "beta"?' });

    await expect(first).resolves.toBe(false);
    expect(useConfirmBridge.getState().pending).toEqual({ title: 'Remove "beta"?' });

    useConfirmBridge.getState().resolve(true);
    await expect(second).resolves.toBe(true);
  });
});

describe('confirm-bridge — resolve with nothing pending', () => {
  it('is a no-op and does not throw', () => {
    expect(() => useConfirmBridge.getState().resolve(true)).not.toThrow();
    expect(useConfirmBridge.getState().pending).toBeNull();
  });
});

describe('confirm-bridge — testid', () => {
  it('round-trips the testid field ConfirmDialogHost reads', () => {
    requestConfirm({ title: 'Remove "alpha"?', testid: 'sessions-remove-project-dialog' });
    expect(useConfirmBridge.getState().pending?.testid).toBe('sessions-remove-project-dialog');
  });
});
