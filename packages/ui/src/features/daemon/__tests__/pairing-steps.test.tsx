/**
 * Step bodies — notice-card testid coverage.
 *
 * The reachable/unreachable NoticeCards and the inline Retry action had no
 * data-testid, forcing text-based selectors (e2e-blocking wiring debt,
 * daemon-picker-report.md). The refusal notices carry theirs from birth: they
 * are the only feedback a user gets when the endpoint policy rejects a plain
 * http host (todo #305).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { INSECURE_ENDPOINT_MESSAGE } from '../endpoint-policy';
import { FooterStep0, Step0Body, Step1Body } from '../pairing-steps';

// input-otp polls document.elementFromPoint from a timer; jsdom doesn't implement it.
document.elementFromPoint ??= () => null;

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

describe('refused endpoint — step 0', () => {
  const LAN_URL = 'http://192.168.1.10:31415';

  it('explains the refusal instead of reporting the URL unreachable', () => {
    render(<Step0Body url={LAN_URL} phase="refused" onUrlChange={vi.fn()} onVerify={vi.fn()} />);

    expect(screen.getByTestId('daemon-add-insecure')).toHaveTextContent(INSECURE_ENDPOINT_MESSAGE);
    expect(screen.queryByTestId('daemon-add-unreachable')).toBeNull();
  });

  it('offers no Retry — the same URL can never pass', () => {
    render(<Step0Body url={LAN_URL} phase="refused" onUrlChange={vi.fn()} onVerify={vi.fn()} />);

    expect(screen.queryByTestId('daemon-add-retry')).toBeNull();
  });

  it('keeps the footer on Verify, so no pairing code can be requested', () => {
    render(<FooterStep0 phase="refused" url={LAN_URL} onCancel={vi.fn()} onVerify={vi.fn()} onContinue={vi.fn()} />);

    expect(screen.getByTestId('daemon-add-verify')).toBeInTheDocument();
    expect(screen.queryByTestId('daemon-add-continue')).toBeNull();
  });
});

describe('refused endpoint — step 1', () => {
  it('renders the same refusal message when confirm is refused', () => {
    render(
      <Step1Body
        lockedUrl="http://192.168.1.10:31415"
        code=""
        device="This Mac"
        phase="insecure"
        onCodeChange={vi.fn()}
        onDeviceChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('daemon-pair-insecure')).toHaveTextContent(INSECURE_ENDPOINT_MESSAGE);
  });
});
