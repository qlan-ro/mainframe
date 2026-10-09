import { describe, it, expect } from 'vitest';
import { toTabEntry } from '../tab-entry';

function entryWith(custom: Record<string, unknown>) {
  return [
    { id: 'chat-a', remoteId: 'chat-a', status: 'regular', custom: { projectId: 'p', adapterId: 'claude', ...custom } },
  ];
}

describe('toTabEntry — waiting', () => {
  it("raises the parent's tab while a delegated child waits on a gate", () => {
    const tab = toTabEntry('chat-a', entryWith({ delegatedWaiting: true }), new Map(), 'chat-a', false, {});
    expect(tab.hasPending).toBe(true);
  });

  it('stays quiet when no gate is open anywhere', () => {
    const tab = toTabEntry('chat-a', entryWith({ delegatedWaiting: false }), new Map(), 'chat-a', false, {});
    expect(tab.hasPending).toBe(false);
  });
});
