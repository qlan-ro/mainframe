/**
 * DaemonRow — TDD tests.
 *
 * Behaviors covered:
 *  1. Remote connected active row: testid present, label+host shown,
 *     active checkmark present, clicking row calls onSwitch.
 *  2. Needs-repair remote: lock indicator visible via dot testid.
 *  3. Local row: shows 'Local' badge, no manage button rendered.
 *  4. Manage popover menu items (bug k) do not bubble into the row's onSwitch
 *     (table-driven across rename/remove/repair — same propagation check).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { DaemonRow } from '../DaemonRow';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REMOTE_META: DaemonMeta = {
  id: 'studio-1',
  kind: 'remote',
  label: 'Studio Mac',
  host: 'studio.example.com:443',
};

const LOCAL_META: DaemonMeta = {
  id: 'local',
  kind: 'local',
  label: 'This Mac',
  host: '127.0.0.1:31415',
};

// ---------------------------------------------------------------------------
// Behavior 1 — connected + active remote row
// ---------------------------------------------------------------------------

describe('DaemonRow — connected active remote', () => {
  it('renders with the correct testid and shows label and host', () => {
    render(<DaemonRow d={REMOTE_META} status="connected" active={true} onSwitch={vi.fn()} />);

    expect(screen.getByTestId('daemon-row-studio-1')).toBeInTheDocument();
    expect(screen.getByText('Studio Mac')).toBeInTheDocument();
    expect(screen.getByText('studio.example.com:443')).toBeInTheDocument();
  });

  it('shows the active checkmark when active=true', () => {
    render(<DaemonRow d={REMOTE_META} status="connected" active={true} onSwitch={vi.fn()} />);

    expect(screen.getByTestId('daemon-row-studio-1-active')).toBeInTheDocument();
  });

  it('does not show an active checkmark when active=false', () => {
    render(<DaemonRow d={REMOTE_META} status="connected" active={false} onSwitch={vi.fn()} />);

    expect(screen.queryByTestId('daemon-row-studio-1-active')).not.toBeInTheDocument();
  });

  it('clicking the row calls onSwitch with the daemon meta', async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();

    render(<DaemonRow d={REMOTE_META} status="connected" active={true} onSwitch={onSwitch} />);

    await user.click(screen.getByTestId('daemon-row-studio-1'));
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith(REMOTE_META);
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — needs-repair remote: lock indicator
// ---------------------------------------------------------------------------

describe('DaemonRow — needs-repair remote', () => {
  it('renders the dot/lock indicator with the dot testid', () => {
    render(<DaemonRow d={REMOTE_META} status="needs-repair" active={false} onSwitch={vi.fn()} />);

    const dotWrapper = screen.getByTestId('daemon-row-studio-1-dot');
    expect(dotWrapper).toBeInTheDocument();
    // The lock SVG icon should be inside the dot wrapper

    const svg = dotWrapper.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — local row: 'Local' badge, no manage button
// ---------------------------------------------------------------------------

describe('DaemonRow — local row', () => {
  it('shows the Local badge', () => {
    render(<DaemonRow d={LOCAL_META} status="connected" active={true} onSwitch={vi.fn()} />);

    expect(screen.getByText('Local')).toBeInTheDocument();
  });

  it('does not render a manage button for local daemons', () => {
    render(<DaemonRow d={LOCAL_META} status="connected" active={true} onSwitch={vi.fn()} />);

    expect(screen.queryByTestId('daemon-row-local-manage')).not.toBeInTheDocument();
  });

  it('renders a manage button for remote daemons', () => {
    render(<DaemonRow d={REMOTE_META} status="connected" active={false} onSwitch={vi.fn()} />);

    expect(screen.getByTestId('daemon-row-studio-1-manage')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Behavior 4 — manage popover menu items don't bubble into onSwitch (bug k)
// ---------------------------------------------------------------------------

describe('DaemonRow — manage menu propagation (bug k)', () => {
  it.each([
    ['Rename…', 'daemon-row-studio-1-rename', 'onRename', 'connected'],
    ['Remove', 'daemon-row-studio-1-remove', 'onRemove', 'connected'],
    ['Re-pair…', 'daemon-row-studio-1-repair', 'onRepair', 'needs-repair'],
  ] as const)(
    'clicking "%s" in the manage popover fires %s but NOT onSwitch',
    async (_label, itemTestId, callbackName, status) => {
      const user = userEvent.setup();
      const onSwitch = vi.fn();
      const callback = vi.fn();

      render(
        <DaemonRow
          d={REMOTE_META}
          status={status}
          active={false}
          onSwitch={onSwitch}
          {...{ [callbackName]: callback }}
        />,
      );

      await user.click(screen.getByTestId('daemon-row-studio-1-manage'));
      await user.click(await screen.findByTestId(itemTestId));

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(REMOTE_META);
      expect(onSwitch).not.toHaveBeenCalled();
    },
  );
});
