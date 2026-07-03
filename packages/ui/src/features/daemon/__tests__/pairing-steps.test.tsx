/**
 * Step0Body — notice-card + retry testid coverage (e2e-blocking wiring debt,
 * daemon-picker-report.md): the reachable/unreachable NoticeCards and the
 * inline Retry action had no data-testid, forcing text-based selectors.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Step0Body } from '../pairing-steps';

describe('Step0Body — notice card testids', () => {
  it('renders daemon-add-reachable when phase is reachable', () => {
    render(<Step0Body url="https://example.com" phase="reachable" onUrlChange={vi.fn()} onVerify={vi.fn()} />);
    expect(screen.getByTestId('daemon-add-reachable')).toHaveTextContent('Daemon reachable');
  });

  it('renders daemon-add-unreachable + daemon-add-retry when phase is unreachable', () => {
    const onVerify = vi.fn();
    render(<Step0Body url="https://example.com" phase="unreachable" onUrlChange={vi.fn()} onVerify={onVerify} />);
    expect(screen.getByTestId('daemon-add-unreachable')).toHaveTextContent("Couldn't reach this URL");

    const retry = screen.getByTestId('daemon-add-retry');
    fireEvent.click(retry);
    expect(onVerify).toHaveBeenCalledTimes(1);
  });

  it('renders neither notice card when phase is idle', () => {
    render(<Step0Body url="" phase="idle" onUrlChange={vi.fn()} onVerify={vi.fn()} />);
    expect(screen.queryByTestId('daemon-add-reachable')).toBeNull();
    expect(screen.queryByTestId('daemon-add-unreachable')).toBeNull();
  });
});
