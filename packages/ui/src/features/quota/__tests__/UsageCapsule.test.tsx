/**
 * UsageCapsule — the title-bar usage capsule: one limit at a time, cycling
 * every 4s; a window at 75%+ pins it; hover pauses the cycle and opens every
 * limit at once; a click pins the popover.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { resetQuota, useQuotaStore } from '@/store/quota';
import { UsageCapsule } from '../UsageCapsule';

const NOW = 1_752_750_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function seed(byId: Record<string, ProviderQuota>) {
  useQuotaStore.setState({ byId });
}

const claude = (session: number): ProviderQuota => ({
  status: 'ok',
  observedAt: NOW,
  session: { kind: 'session', usedPercent: session, resetsAt: NOW + 2 * HOUR + 36 * 60_000 },
  weekly: { kind: 'weekly', usedPercent: 41, resetsAt: NOW + 4 * DAY + HOUR },
  modelWindows: [],
});
const codex: ProviderQuota = {
  status: 'ok',
  observedAt: NOW,
  weekly: { kind: 'weekly', usedPercent: 17, resetsAt: NOW + 6 * DAY + 2 * HOUR },
  modelWindows: [],
};

function capsule() {
  return screen.getByTestId('usage-capsule');
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetQuota();
});

describe('UsageCapsule — cycle', () => {
  it('starts on the first window and steps through every window every 4s, wrapping around', () => {
    seed({ claude: claude(3), codex });
    render(<UsageCapsule now={NOW} />);

    expect(capsule()).toHaveAttribute('aria-label', 'Usage: Claude 5-hour 3%, resets in 2h 36m');
    advance(4_000);
    expect(capsule()).toHaveAttribute('aria-label', 'Usage: Claude Weekly 41%, resets in 4d 1h');
    advance(4_000);
    expect(capsule()).toHaveAttribute('aria-label', 'Usage: Codex Weekly 17%, resets in 6d 2h');
    advance(4_000);
    expect(capsule()).toHaveAttribute('aria-label', 'Usage: Claude 5-hour 3%, resets in 2h 36m');
  });

  it('shows one position dot per window, the current one active', () => {
    seed({ claude: claude(3), codex });
    render(<UsageCapsule now={NOW} />);
    advance(4_000);

    const dots = screen.getByTestId('usage-capsule-dots').children;
    expect(dots).toHaveLength(3);
    expect(dots[1]).toHaveAttribute('data-active');
    expect(dots[0]).not.toHaveAttribute('data-active');
  });

  it('pauses while the pointer is over it', () => {
    seed({ claude: claude(3), codex });
    render(<UsageCapsule now={NOW} />);

    fireEvent.pointerEnter(capsule());
    advance(12_000);
    expect(capsule()).toHaveAttribute('aria-label', 'Usage: Claude 5-hour 3%, resets in 2h 36m');
  });

  it('reads as unknown, with no dots, when no provider reports a trusted window', () => {
    render(<UsageCapsule now={NOW} />);
    expect(capsule()).toHaveAttribute('aria-label', 'Usage: quota unknown');
    expect(screen.queryByTestId('usage-capsule-dots')).toBeNull();
  });
});

describe('UsageCapsule — pinned', () => {
  it('stops on a window at 75%+ and drops the dots', () => {
    seed({ claude: claude(84), codex });
    render(<UsageCapsule now={NOW} />);

    expect(capsule()).toHaveAttribute('data-pinned');
    expect(capsule()).toHaveAttribute('aria-label', 'Usage: Claude 5-hour 84%, resets in 2h 36m');
    advance(12_000);
    expect(capsule()).toHaveAttribute('aria-label', 'Usage: Claude 5-hour 84%, resets in 2h 36m');
    expect(screen.queryByTestId('usage-capsule-dots')).toBeNull();
  });

  it('inks a pinned window warning at 75%+ and destructive at 90%+', () => {
    seed({ claude: claude(84) });
    const { unmount } = render(<UsageCapsule now={NOW} />);
    expect(screen.getByTestId('usage-capsule-item-claude:5-hour').textContent).toContain('84%');
    expect(screen.getByText('84%')).toHaveClass('text-warning');
    unmount();

    seed({ claude: claude(96) });
    render(<UsageCapsule now={NOW} />);
    expect(screen.getByText('96%')).toHaveClass('text-destructive');
  });
});

describe('UsageCapsule — popover', () => {
  it('opens every provider on hover after a short delay and closes on leave', () => {
    seed({ claude: claude(3), codex });
    render(<UsageCapsule now={NOW} />);

    fireEvent.pointerEnter(capsule());
    expect(screen.queryByTestId('usage-popover')).toBeNull();
    advance(300);
    expect(screen.getByTestId('usage-popover-provider-claude')).toBeInTheDocument();
    expect(screen.getByTestId('usage-popover-provider-codex')).toBeInTheDocument();
    expect(screen.getByTestId('usage-popover-window-claude-session')).toHaveAttribute(
      'aria-label',
      'Claude 5-hour: 3% used, resets in 2h 36m',
    );

    fireEvent.pointerLeave(capsule());
    advance(200);
    expect(screen.queryByTestId('usage-popover')).toBeNull();
  });

  it('stays open after the pointer leaves once a click pins it, and a second click unpins it', () => {
    seed({ claude: claude(3), codex });
    render(<UsageCapsule now={NOW} />);

    fireEvent.click(capsule());
    expect(screen.getByTestId('usage-popover')).toBeInTheDocument();
    fireEvent.pointerLeave(capsule());
    advance(1_000);
    expect(screen.getByTestId('usage-popover')).toBeInTheDocument();

    fireEvent.click(capsule());
    expect(screen.queryByTestId('usage-popover')).toBeNull();
  });

  it('marks a provider with nothing trusted as quota unknown', () => {
    seed({ claude: claude(3) });
    render(<UsageCapsule now={NOW} />);

    fireEvent.click(capsule());
    expect(screen.getByTestId('usage-popover-unknown-codex')).toBeInTheDocument();
  });
});
