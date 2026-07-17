/**
 * DaemonPicker — TDD tests.
 *
 * Behaviors covered:
 *  1. With an active unreachable remote: fallback banner renders; clicking it
 *     calls onSwitch with the local entry.
 *  1b. With an active needs-repair remote: fallback banner renders with Lock
 *      icon + "needs re-pairing" copy; clicking still switches to local.
 *  2. The "Add remote daemon" footer fires onAdd (and close).
 *  3. With no remote daemons: the empty-state element renders.
 *
 * (Dropped a duplicate render-only test in the needs-repair describe that
 * repeated behavior-1's banner-presence check with a different status fn —
 * the Lock-icon/copy test right below it already asserts the banner is
 * present via getByTestId, which throws if absent.)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import type { DaemonStatus } from '../DaemonRow';
import { DaemonPicker } from '../DaemonPicker';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOCAL: DaemonMeta = {
  id: 'local',
  kind: 'local',
  label: 'This Mac',
  host: '127.0.0.1:31415',
};

const STUDIO: DaemonMeta = {
  id: 'studio-1',
  kind: 'remote',
  label: 'Studio Mac',
  host: 'studio.example.com:443',
};

const HEL: DaemonMeta = {
  id: 'hel1',
  kind: 'remote',
  label: 'Hetzner HEL',
  host: 'hel1.example.com:443',
};

const ALL_DAEMONS = [LOCAL, STUDIO, HEL];

function statusOf(id: string): DaemonStatus {
  if (id === 'studio-1') return 'connected';
  if (id === 'hel1') return 'unreachable';
  return 'connected';
}

// ---------------------------------------------------------------------------
// Behavior 1 — fallback banner when active remote is unreachable
// ---------------------------------------------------------------------------

describe('DaemonPicker — fallback banner', () => {
  it('renders the fallback banner when the active daemon is unreachable', () => {
    render(
      <DaemonPicker daemons={ALL_DAEMONS} statusOf={statusOf} activeId="hel1" onSwitch={vi.fn()} onAdd={vi.fn()} />,
    );

    expect(screen.getByTestId('daemon-picker-fallback')).toBeInTheDocument();
  });

  it('clicking the fallback banner calls onSwitch with the local entry', async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    const close = vi.fn();

    render(
      <DaemonPicker
        daemons={ALL_DAEMONS}
        statusOf={statusOf}
        activeId="hel1"
        onSwitch={onSwitch}
        onAdd={vi.fn()}
        close={close}
      />,
    );

    await user.click(screen.getByTestId('daemon-picker-fallback'));

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith(LOCAL);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the fallback banner when the active daemon is connected', () => {
    render(
      <DaemonPicker daemons={ALL_DAEMONS} statusOf={statusOf} activeId="studio-1" onSwitch={vi.fn()} onAdd={vi.fn()} />,
    );

    expect(screen.queryByTestId('daemon-picker-fallback')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Behavior 1b — fallback banner when active remote needs-repair
// ---------------------------------------------------------------------------

describe('DaemonPicker — fallback banner (needs-repair branch)', () => {
  function statusOfRepair(id: string): DaemonStatus {
    if (id === 'hel1') return 'needs-repair';
    return 'connected';
  }

  it('shows the Lock icon (svg) and "needs re-pairing" detail text', () => {
    render(
      <DaemonPicker
        daemons={ALL_DAEMONS}
        statusOf={statusOfRepair}
        activeId="hel1"
        onSwitch={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    const banner = screen.getByTestId('daemon-picker-fallback');
    // The Lock svg should be present inside the banner
    expect(banner.querySelector('svg')).not.toBeNull();
    // "needs re-pairing" copy should appear
    expect(banner).toHaveTextContent('needs re-pairing');
    // "is unreachable" copy should NOT appear
    expect(banner).not.toHaveTextContent('is unreachable');
  });

  it('clicking the needs-repair banner still calls onSwitch with local', async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    const close = vi.fn();

    render(
      <DaemonPicker
        daemons={ALL_DAEMONS}
        statusOf={statusOfRepair}
        activeId="hel1"
        onSwitch={onSwitch}
        onAdd={vi.fn()}
        close={close}
      />,
    );

    await user.click(screen.getByTestId('daemon-picker-fallback'));

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith(LOCAL);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — add footer fires onAdd
// ---------------------------------------------------------------------------

describe('DaemonPicker — add footer', () => {
  it('fires onAdd when the add footer is clicked', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const close = vi.fn();

    render(
      <DaemonPicker
        daemons={ALL_DAEMONS}
        statusOf={statusOf}
        activeId="local"
        onSwitch={vi.fn()}
        onAdd={onAdd}
        close={close}
      />,
    );

    await user.click(screen.getByTestId('daemon-picker-add'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — empty state when no remotes
// ---------------------------------------------------------------------------

describe('DaemonPicker — empty state', () => {
  it('renders the empty state when there are no remote daemons', () => {
    render(
      <DaemonPicker
        daemons={[LOCAL]}
        statusOf={() => 'connected'}
        activeId="local"
        onSwitch={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getByTestId('daemon-picker-empty')).toBeInTheDocument();
  });

  it('does NOT render the empty state when remotes exist', () => {
    render(
      <DaemonPicker daemons={ALL_DAEMONS} statusOf={statusOf} activeId="local" onSwitch={vi.fn()} onAdd={vi.fn()} />,
    );

    expect(screen.queryByTestId('daemon-picker-empty')).not.toBeInTheDocument();
  });
});
