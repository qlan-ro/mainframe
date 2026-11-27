/**
 * The "Starting up" card only shows when the daemon takes a moment: a connect that lands inside
 * the delay never draws it, and one that shows it holds it long enough to read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const connection = vi.hoisted(() => ({ ready: false }));

vi.mock('../useConnectionState', () => ({
  useConnectionState: () => ({
    state: 'connecting',
    daemonStatus: 'initializing',
    port: connection.ready ? 31415 : null,
    ready: connection.ready,
  }),
}));
vi.mock('../../lib/daemon/ws-client', () => ({
  daemonWs: {
    setPort: vi.fn(),
    connect: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    subscribeConnection: vi.fn(() => () => {}),
    connected: false,
  },
}));
vi.mock('../AppShell', () => ({ AppShell: () => <div data-testid="shell" /> }));
vi.mock('../../lib/lsp', () => ({ initLspPort: vi.fn(() => Promise.resolve()) }));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('@/store/adapters-seed', () => ({ seedAdaptersFor: vi.fn() }));
vi.mock('@/store/quota-seed', () => ({ seedQuota: vi.fn() }));
vi.mock('@/store/cli-update-seed', () => ({ seedProviderCliStatusesFor: vi.fn() }));
vi.mock('@/store/port-tunnels-seed', () => ({ seedPortTunnels: vi.fn() }));

import { App, STARTUP_CARD_DELAY_MS, STARTUP_CARD_MIN_VISIBLE_MS } from '../App';

const card = () => screen.queryByTestId('app-waiting-daemon');
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  connection.ready = false;
});
afterEach(() => vi.useRealTimers());

describe('App startup card', () => {
  it('draws no card in the first frame: just the ground', () => {
    render(<App />);
    expect(card()).toBeNull();
  });

  it('shows the card once the wait outlasts the delay', () => {
    render(<App />);
    advance(STARTUP_CARD_DELAY_MS - 1);
    expect(card()).toBeNull();
    advance(1);
    expect(card()).not.toBeNull();
  });

  it('never shows it when the daemon answers inside the delay', () => {
    const view = render(<App />);
    advance(STARTUP_CARD_DELAY_MS - 50);
    connection.ready = true;
    view.rerender(<App />);
    advance(1000);
    expect(card()).toBeNull();
    expect(screen.getByTestId('shell')).toBeInTheDocument();
  });

  it('keeps a card that has shown for the minimum, so it does not flicker away', () => {
    const view = render(<App />);
    advance(STARTUP_CARD_DELAY_MS);
    expect(card()).not.toBeNull();
    connection.ready = true;
    view.rerender(<App />);
    // The shell replaces the waiting region at once; the card was part of it.
    expect(screen.getByTestId('shell')).toBeInTheDocument();
    advance(STARTUP_CARD_MIN_VISIBLE_MS);
    expect(card()).toBeNull();
  });
});
