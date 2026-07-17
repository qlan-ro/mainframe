import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TunnelControl } from '../TunnelControl';
import type { UseTunnelStatusResult } from '../use-tunnel-status';

const getTunnelConfig = vi.fn();
vi.mock('../../../../../lib/api/remote-access', () => ({
  getTunnelConfig: (...a: unknown[]) => getTunnelConfig(...a),
}));

function makeTunnel(over: Partial<UseTunnelStatusResult> = {}): UseTunnelStatusResult {
  return {
    state: 'idle',
    url: null,
    errorMsg: null,
    loading: false,
    togglingAction: null,
    running: false,
    verified: false,
    start: vi.fn(),
    stop: vi.fn(),
    retryVerify: vi.fn(),
    ...over,
  };
}
beforeEach(() => getTunnelConfig.mockResolvedValue({ hasToken: false, url: null }));
afterEach(() => vi.clearAllMocks());

describe('TunnelControl', () => {
  it('shows the quick-tunnel toggle when no named config exists', async () => {
    render(<TunnelControl port={31415} tunnel={makeTunnel()} />);
    expect(await screen.findByTestId('quick-tunnel-toggle')).toBeInTheDocument();
  });
  it('quick toggle calls start when idle', async () => {
    const start = vi.fn();
    render(<TunnelControl port={31415} tunnel={makeTunnel({ start })} />);
    fireEvent.click(await screen.findByTestId('quick-tunnel-toggle'));
    expect(start).toHaveBeenCalled();
  });
  it('hides the quick tunnel when a named config exists', async () => {
    getTunnelConfig.mockResolvedValue({ hasToken: true, url: 'https://x' });
    render(<TunnelControl port={31415} tunnel={makeTunnel()} />);
    expect(await screen.findByTestId('named-tunnel-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('quick-tunnel-toggle')).toBeNull();
  });
});
