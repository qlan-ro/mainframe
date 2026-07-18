/**
 * Seam-4 — the quota surface renders each designed state from a ProviderQuota
 * fixture in the store: normal / amber ≥75 / red ≥90 / unknown-dashed / stale /
 * mixed, plus the tightest-window collapsed row and the all-windows popover.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: { onEvent: vi.fn(() => () => {}) },
}));
vi.mock('@/lib/api/quota', () => ({
  refreshQuota: vi.fn(() => Promise.resolve(null)),
  getQuota: vi.fn(() => Promise.resolve(null)),
}));

import { QuotaCard } from '../QuotaCard';
import { applyProviderQuota, resetQuota } from '@/store/quota';
import { refreshQuota } from '@/lib/api/quota';

const NOW = 1_752_750_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const claudeThreeWindows = (tightestModel: number): ProviderQuota => ({
  status: 'ok',
  observedAt: NOW - 40_000,
  session: { kind: 'session', usedPercent: 36, resetsAt: NOW + 2 * HOUR },
  weekly: { kind: 'weekly', usedPercent: 21, resetsAt: NOW + 6 * DAY + 2 * HOUR },
  modelWindows: [{ kind: 'weekly-model', usedPercent: tightestModel, resetsAt: NOW + 6 * DAY, label: 'Fable' }],
});

const singleSession = (usedPercent: number, observedAt = NOW - 40_000): ProviderQuota => ({
  status: 'ok',
  observedAt,
  modelWindows: [],
  session: { kind: 'session', usedPercent, resetsAt: NOW + 2 * HOUR },
});

beforeEach(() => resetQuota());
afterEach(() => vi.clearAllMocks());

describe('QuotaCard — always both providers', () => {
  it('renders a claude and a codex row even with an empty store, both unknown', () => {
    render(<QuotaCard now={NOW} />);
    const claude = screen.getByTestId('provider-quota-row-claude');
    const codex = screen.getByTestId('provider-quota-row-codex');
    expect(claude).toHaveAttribute('data-state-kind', 'unknown');
    expect(codex).toHaveAttribute('data-state-kind', 'unknown');
    expect(within(claude).getByText('?')).toBeInTheDocument();
  });

  it('the unknown row shows a dashed ring, never a blank or fake zero', () => {
    render(<QuotaCard now={NOW} />);
    const claude = screen.getByTestId('provider-quota-row-claude');
    expect(claude.querySelector('.border-dashed')).not.toBeNull();
  });
});

describe('QuotaCard — collapsed row surfaces the tightest window', () => {
  it('shows the highest-percent window (88), not the session (36)', () => {
    applyProviderQuota('claude', claudeThreeWindows(88));
    render(<QuotaCard now={NOW} />);
    const row = screen.getByTestId('provider-quota-row-claude');
    expect(within(row).getByText('88%')).toBeInTheDocument();
    expect(within(row).queryByText('36%')).not.toBeInTheDocument();
    expect(row).toHaveAttribute('data-state-kind', 'ok');
    expect(row).toHaveAttribute('aria-label', expect.stringContaining('88% used'));
  });
});

describe('QuotaCard — near-wall severities', () => {
  it('normal (<75) uses the healthy foreground percent colour', () => {
    applyProviderQuota('claude', singleSession(36));
    render(<QuotaCard now={NOW} />);
    expect(within(screen.getByTestId('provider-quota-row-claude')).getByText('36%').className).toContain('text-foreground');
  });

  it('amber at 80 (≥75)', () => {
    applyProviderQuota('claude', singleSession(80));
    render(<QuotaCard now={NOW} />);
    expect(within(screen.getByTestId('provider-quota-row-claude')).getByText('80%').className).toContain('text-mf-warning');
  });

  it('red at 92 (≥90)', () => {
    applyProviderQuota('claude', singleSession(92));
    render(<QuotaCard now={NOW} />);
    expect(within(screen.getByTestId('provider-quota-row-claude')).getByText('92%').className).toContain('text-destructive');
  });
});

describe('QuotaCard — expired fails closed, stale still shows', () => {
  it('a window whose reset has passed renders the unknown row', () => {
    applyProviderQuota('claude', {
      status: 'ok',
      observedAt: NOW - 6 * HOUR,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 50, resetsAt: NOW - HOUR },
    });
    render(<QuotaCard now={NOW} />);
    expect(screen.getByTestId('provider-quota-row-claude')).toHaveAttribute('data-state-kind', 'unknown');
  });

  it('a stale-but-live blob keeps its numbers and marks the row stale', () => {
    applyProviderQuota('claude', singleSession(44, NOW - 13 * 60 * 1000));
    render(<QuotaCard now={NOW} />);
    const row = screen.getByTestId('provider-quota-row-claude');
    expect(row).toHaveAttribute('data-state-kind', 'ok');
    expect(row).toHaveAttribute('aria-label', expect.stringContaining('stale'));
  });
});

describe('QuotaCard — mixed providers', () => {
  it('claude ok + codex unknown side by side', () => {
    applyProviderQuota('claude', singleSession(60));
    render(<QuotaCard now={NOW} />);
    expect(screen.getByTestId('provider-quota-row-claude')).toHaveAttribute('data-state-kind', 'ok');
    expect(screen.getByTestId('provider-quota-row-codex')).toHaveAttribute('data-state-kind', 'unknown');
  });
});

describe('QuotaCard — expanded popover', () => {
  it('lists every window with an absolute reset and a manual refresh', async () => {
    const user = userEvent.setup();
    applyProviderQuota('claude', claudeThreeWindows(88));
    render(<QuotaCard now={NOW} />);

    await user.click(screen.getByTestId('provider-quota-row-claude'));

    const pop = await screen.findByTestId('provider-quota-popover-claude');
    expect(within(pop).getByTestId('provider-quota-window-claude-session')).toBeInTheDocument();
    expect(within(pop).getByTestId('provider-quota-window-claude-weekly')).toBeInTheDocument();
    expect(within(pop).getByTestId('provider-quota-window-claude-weekly-model')).toBeInTheDocument();
    expect(within(pop).getAllByText(/resets in/).length).toBeGreaterThan(0);
    expect(within(pop).getByTestId('provider-quota-refresh-claude')).toBeInTheDocument();

    // The weekly-model window carries provider + percent + reset for screen readers.
    expect(within(pop).getByTestId('provider-quota-window-claude-weekly-model')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('88% used'),
    );
  });

  it('shows an absolute reset timestamp for a window (UTC-pinned)', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const user = userEvent.setup();
      applyProviderQuota('claude', singleSession(60)); // session resets at NOW + 2h → Jul 17, 1:00 PM UTC
      render(<QuotaCard now={NOW} />);

      await user.click(screen.getByTestId('provider-quota-row-claude'));
      const pop = await screen.findByTestId('provider-quota-popover-claude');
      expect(within(pop).getByText('Jul 17, 1:00 PM')).toBeInTheDocument();
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it('a best-effort null-reset window keeps its percent and reads "reset time unknown"', async () => {
    const user = userEvent.setup();
    applyProviderQuota('claude', {
      status: 'ok',
      observedAt: NOW - 40_000,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 63, resetsAt: null },
    });
    render(<QuotaCard now={NOW} />);

    await user.click(screen.getByTestId('provider-quota-row-claude'));
    const win = within(await screen.findByTestId('provider-quota-popover-claude')).getByTestId(
      'provider-quota-window-claude-session',
    );
    expect(within(win).getByText('63%')).toBeInTheDocument();
    expect(win).toHaveAttribute('aria-label', expect.stringContaining('reset time unknown'));
    expect(within(win).queryByText(/resets in/)).not.toBeInTheDocument();
  });

  it('an unknown provider popover explains the silence and still offers refresh', async () => {
    const user = userEvent.setup();
    render(<QuotaCard now={NOW} />);

    await user.click(screen.getByTestId('provider-quota-row-codex'));

    const pop = await screen.findByTestId('provider-quota-popover-codex');
    expect(within(pop).getByTestId('provider-quota-unknown-codex')).toBeInTheDocument();
    expect(within(pop).getByTestId('provider-quota-refresh-codex')).toBeInTheDocument();
  });

  it('clicking refresh calls the refresh endpoint for that provider', async () => {
    const user = userEvent.setup();
    applyProviderQuota('claude', singleSession(60));
    render(<QuotaCard now={NOW} />);

    await user.click(screen.getByTestId('provider-quota-row-claude'));
    await user.click(await screen.findByTestId('provider-quota-refresh-claude'));

    expect(vi.mocked(refreshQuota)).toHaveBeenCalledWith('claude');
  });
});
