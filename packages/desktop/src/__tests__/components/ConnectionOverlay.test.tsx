import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../renderer/hooks/useConnectionState.js', () => ({
  useConnectionState: vi.fn().mockReturnValue(true),
}));

import { useConnectionState } from '../../renderer/hooks/useConnectionState.js';
import { ConnectionOverlay, ConnectionOverlayView } from '../../renderer/components/ConnectionOverlay.js';

describe('ConnectionOverlayView', () => {
  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionOverlayView connected={true} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders overlay when disconnected', () => {
    render(<ConnectionOverlayView connected={false} />);
    expect(screen.getByTestId('connection-overlay')).toBeInTheDocument();
  });

  it('shows reconnecting text when disconnected', () => {
    render(<ConnectionOverlayView connected={false} />);
    expect(screen.getByText(/Reconnecting to daemon/)).toBeInTheDocument();
  });

  it('renders a spinner when disconnected', () => {
    const { container } = render(<ConnectionOverlayView connected={false} />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });
});

describe('ConnectionOverlay', () => {
  it('renders nothing when useConnectionState returns true', () => {
    vi.mocked(useConnectionState).mockReturnValue(true);
    const { container } = render(<ConnectionOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('renders overlay when useConnectionState returns false', () => {
    vi.mocked(useConnectionState).mockReturnValue(false);
    render(<ConnectionOverlay />);
    expect(screen.getByTestId('connection-overlay')).toBeInTheDocument();
  });
});
