/**
 * DaemonPortContext — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - useDaemonPort() inside <DaemonPortProvider port={31415}> returns 31415.
 *  - Re-rendering with port={9000} makes useDaemonPort() return 9000.
 *  - useDaemonPort() with NO provider throws with message containing 'DaemonPortProvider'.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { DaemonPortProvider, useDaemonPort } from '../daemon-port-context';

// ---------------------------------------------------------------------------
// Helper: a child component that renders the port value as text
// ---------------------------------------------------------------------------

function PortDisplay() {
  const port = useDaemonPort();
  return <span data-testid="port-display">{port}</span>;
}

// ---------------------------------------------------------------------------
// DaemonPortContext
// ---------------------------------------------------------------------------

describe('DaemonPortContext — useDaemonPort returns the provided port', () => {
  it('returns 31415 when wrapped in <DaemonPortProvider port={31415}>', () => {
    render(
      <DaemonPortProvider port={31415}>
        <PortDisplay />
      </DaemonPortProvider>,
    );
    expect(screen.getByTestId('port-display').textContent).toBe('31415');
  });
});

describe('DaemonPortContext — useDaemonPort reflects prop changes', () => {
  it('returns 9000 after re-rendering the provider with port={9000}', () => {
    const { rerender } = render(
      <DaemonPortProvider port={31415}>
        <PortDisplay />
      </DaemonPortProvider>,
    );

    rerender(
      <DaemonPortProvider port={9000}>
        <PortDisplay />
      </DaemonPortProvider>,
    );

    expect(screen.getByTestId('port-display').textContent).toBe('9000');
  });
});

describe('DaemonPortContext — useDaemonPort throws when no provider is present', () => {
  it('throws an error whose message contains "DaemonPortProvider"', () => {
    expect(() => renderHook(() => useDaemonPort())).toThrow(/DaemonPortProvider/);
  });
});
