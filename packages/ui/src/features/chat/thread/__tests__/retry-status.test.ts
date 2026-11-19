import { describe, expect, it } from 'vitest';
import { retryStatusLabel, retryStatusTestId } from '../retry-status';

describe('retryStatusLabel', () => {
  it('shows Codex numbers when attempt and maximum are known', () => {
    expect(retryStatusLabel({ attempt: 2, maxAttempts: 5 })).toBe('Reconnecting (2/5)…');
    expect(retryStatusLabel({ attempt: 1, maxAttempts: 5 })).toBe('Reconnecting (1/5)…');
  });
  it('shows only the attempt when no maximum is known', () => {
    expect(retryStatusLabel({ attempt: 2 })).toBe('Reconnecting (2)…');
  });
  it('shows no numbers for an unknown attempt', () => {
    expect(retryStatusLabel({ attempt: 0 })).toBe('Reconnecting…');
    expect(retryStatusLabel({ attempt: 0, maxAttempts: 5 })).toBe('Reconnecting…');
    expect(retryStatusLabel({ attempt: -1 })).toBe('Reconnecting…');
  });
});

it('names the test id after the chat', () => {
  expect(retryStatusTestId('chat-9')).toBe('chat-retry-status-chat-9');
});
