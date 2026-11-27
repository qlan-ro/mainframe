/** What the shell asks the daemon for while booting: the remembered chat is requested first, before the seeds. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const calls: string[] = [];
const listeners = new Set<() => void>();
const ws = vi.hoisted(() => ({ connected: false }));

vi.mock('../useConnectionState', () => ({
  useConnectionState: () => ({ state: 'connected', daemonStatus: 'running', port: 31415, ready: true }),
}));
vi.mock('../../lib/daemon/ws-client', () => ({
  daemonWs: {
    setPort: vi.fn(),
    connect: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    subscribeConnection: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    get connected() {
      return ws.connected;
    },
  },
}));
vi.mock('@/features/sessions/runtime/boot-chat-prewarm', () => ({
  startBootChatPrewarm: vi.fn((port: number) => calls.push(`prewarm:${port}`)),
}));
vi.mock('@/store/adapters-seed', () => ({ seedAdaptersFor: vi.fn(() => calls.push('adapters')) }));
vi.mock('@/store/quota-seed', () => ({ seedQuota: vi.fn(() => calls.push('quota')) }));
vi.mock('@/store/cli-update-seed', () => ({ seedProviderCliStatusesFor: vi.fn(() => calls.push('cli')) }));
vi.mock('@/store/port-tunnels-seed', () => ({ seedPortTunnels: vi.fn(() => calls.push('tunnels')) }));
vi.mock('../AppShell', () => ({ AppShell: () => <div data-testid="shell" /> }));
vi.mock('../../lib/lsp', () => ({ initLspPort: vi.fn(() => Promise.resolve()) }));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));

import { App } from '../App';

beforeEach(() => {
  calls.length = 0;
  listeners.clear();
  ws.connected = false;
});

describe('App boot requests', () => {
  it('requests the remembered chat before any seed', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(calls).toEqual(['prewarm:31415', 'adapters', 'quota', 'cli', 'tunnels']);
  });
});
