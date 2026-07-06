/**
 * PreviewBodyState — tunnel-failed card.
 *
 * Covers the in-body tunnel-failure state added alongside `tunnelPending`:
 * it must win over the `running` branch (status IS 'running' when the
 * tunnel fails) and surface the tunnel error text when present.
 */
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PreviewBodyState } from '../PreviewBodyState';

function renderState(overrides: Partial<React.ComponentProps<typeof PreviewBodyState>> = {}) {
  const anchorRef = createRef<HTMLDivElement>();
  return render(
    <PreviewBodyState
      status="running"
      device="desktop"
      inspectActive={false}
      anchorRef={anchorRef}
      onStart={() => {}}
      {...overrides}
    />,
  );
}

describe('PreviewBodyState — tunnel failed', () => {
  it('renders the tunnel-failed card instead of the running webview body', () => {
    renderState({ tunnelFailed: true, tunnelError: 'cloudflared missing' });

    expect(screen.getByTestId('preview-body-tunnel-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-body-running')).toBeNull();
  });

  it('shows the tunnel error text when present', () => {
    renderState({ tunnelFailed: true, tunnelError: 'cloudflared missing' });

    expect(screen.getByText('cloudflared missing')).toBeInTheDocument();
  });

  it('omits the error line when tunnelError is null', () => {
    renderState({ tunnelFailed: true, tunnelError: null });

    expect(screen.getByTestId('preview-body-tunnel-failed')).toBeInTheDocument();
  });

  it('shows a hint pointing at the console drawer', () => {
    renderState({ tunnelFailed: true, tunnelError: null });

    expect(screen.getByText('Process logs are in the console below')).toBeInTheDocument();
  });

  it('wins over the running branch even though status is running', () => {
    renderState({ tunnelFailed: true, tunnelError: null, status: 'running' });

    expect(screen.getByTestId('preview-body-tunnel-failed')).toBeInTheDocument();
  });
});
