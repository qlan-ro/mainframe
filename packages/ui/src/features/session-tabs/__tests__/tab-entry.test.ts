import { describe, it, expect } from 'vitest';
import { toTabEntry } from '../tab-entry';

function entryWith(custom: Record<string, unknown>) {
  return [
    { id: 'chat-a', remoteId: 'chat-a', status: 'regular', custom: { projectId: 'p', adapterId: 'claude', ...custom } },
  ];
}

describe('toTabEntry — status', () => {
  const statusOf = (custom: Record<string, unknown>) =>
    toTabEntry('chat-a', entryWith(custom), new Map(), 'chat-a', false, {}).status;

  it.each(['hasPending', 'sideChatWaiting', 'delegatedWaiting'])('needs you while %s', (field) => {
    expect(statusOf({ [field]: true })).toBe('waiting');
  });

  it('runs while the chat or its sub-agents work', () => {
    expect(statusOf({ displayStatus: 'working', isRunning: false })).toBe('working');
  });

  it('puts needing you ahead of running', () => {
    expect(statusOf({ displayStatus: 'working', delegatedWaiting: true })).toBe('waiting');
  });

  it('is idle when nothing runs and no gate is open', () => {
    expect(statusOf({ displayStatus: 'idle', delegatedWaiting: false })).toBe('idle');
  });

  it('is idle for a draft with no thread-list entry yet', () => {
    expect(toTabEntry('__LOCALID_1', [], new Map(), '__LOCALID_1', false, {}).status).toBe('idle');
  });
});
