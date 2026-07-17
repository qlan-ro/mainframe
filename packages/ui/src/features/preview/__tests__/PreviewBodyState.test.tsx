/**
 * PreviewBodyState — tunnel-failed card.
 *
 * Covers the in-body tunnel-failure state added alongside `tunnelPending`:
 * it must win over the `running` branch (status IS 'running' when the
 * tunnel fails) and surface the tunnel error text when present.
 *
 * (The three tunnelError-presence checks collapsed into one it.each: the old
 * null-case test only re-checked the card testid without ever asserting the
 * error line was actually absent, so the merge also fixes that gap.)
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
  it.each([
    ['cloudflared missing', true],
    [null, false],
  ] as const)(
    'renders the tunnel-failed card instead of the running body, showing the error line only when tunnelError=%s',
    (tunnelError, showsErrorLine) => {
      const { container } = renderState({ tunnelFailed: true, tunnelError });

      expect(screen.getByTestId('preview-body-tunnel-failed')).toBeInTheDocument();
      expect(screen.queryByTestId('preview-body-running')).toBeNull();

      const errorLine = container.querySelector('.font-mono');
      if (showsErrorLine) {
        expect(errorLine).toHaveTextContent(tunnelError!);
      } else {
        expect(errorLine).toBeNull();
      }
    },
  );

  it('shows a hint pointing at the console drawer', () => {
    renderState({ tunnelFailed: true, tunnelError: null });

    expect(screen.getByText('Process logs are in the console below')).toBeInTheDocument();
  });

  it('wins over the running branch even though status is running', () => {
    renderState({ tunnelFailed: true, tunnelError: null, status: 'running' });

    expect(screen.getByTestId('preview-body-tunnel-failed')).toBeInTheDocument();
  });
});
