import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionOverlay } from '../ConnectionOverlay';

describe('ConnectionOverlay', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(<ConnectionOverlay open={false} embedded />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the reconnecting title when open and embedded', () => {
    render(<ConnectionOverlay open embedded />);
    expect(screen.getByText('Reconnecting to daemon…')).toBeTruthy();
  });

  it('renders the secondary message when open and embedded', () => {
    render(<ConnectionOverlay open embedded />);
    expect(screen.getByText(/Your sessions are safe/)).toBeTruthy();
  });

  it('has no button element', () => {
    render(<ConnectionOverlay open embedded />);
    expect(document.querySelector('button')).toBeNull();
  });

  it('has the connection-overlay data-testid when open', () => {
    render(<ConnectionOverlay open embedded />);
    expect(screen.getByTestId('connection-overlay')).toBeTruthy();
  });
});
