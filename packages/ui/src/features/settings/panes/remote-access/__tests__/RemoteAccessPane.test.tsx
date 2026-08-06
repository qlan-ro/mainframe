import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RemoteAccessPane } from '../RemoteAccessPane';
import type { UseTunnelStatusResult } from '../use-tunnel-status';

const mockUseTunnelStatus = vi.fn<() => UseTunnelStatusResult>();
vi.mock('../use-tunnel-status', () => ({
  useTunnelStatus: () => mockUseTunnelStatus(),
}));
vi.mock('../TunnelControl', () => ({ TunnelControl: () => null }));

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

describe('RemoteAccessPane heading', () => {
  it('renders "Remote Access" as the v2 pane heading (text-lg/semibold)', () => {
    mockUseTunnelStatus.mockReturnValue(makeTunnel());
    render(<RemoteAccessPane port={31415} />);
    const heading = screen.getByText('Remote Access');
    expect(heading.className).toContain('text-lg');
    expect(heading.className).toContain('font-semibold');
  });
});
