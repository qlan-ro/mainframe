/**
 * NavRail — unit tests.
 *
 * D3/D4: the rail owns `sidebarView` (chats/tasks/automations); selecting a
 * view also shows the sidebar. The automations pending dot comes from
 * `selectPendingInteractionCount`. The update button (`RailUpdateButton`)
 * renders null while idle and a dot-carrying button once the host reports an
 * update.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiPrefs } from '@/store/ui-prefs';
import { useAutomationsStore } from '@/features/automations/data/use-automations-store';
import type { AutomationInteractionSummary } from '@/features/automations/contract';

let mockUpdateStatus: { state: string; version?: string; percent?: number } = { state: 'not-available' };
const onStatus = vi.fn((cb: (s: typeof mockUpdateStatus) => void) => {
  cb(mockUpdateStatus);
  return Promise.resolve(() => undefined);
});
const download = vi.fn();
const install = vi.fn();
vi.mock('@/lib/host', () => ({
  useHost: () => ({ updates: { onStatus, download, install } }),
}));

import { NavRail } from '../NavRail';

const render_ = () =>
  render(
    <TooltipProvider>
      <NavRail />
    </TooltipProvider>,
  );

function interaction(id: string): AutomationInteractionSummary {
  return {
    id,
    runId: `run-${id}`,
    stepRef: 'step-1',
    title: 'Needs your input',
    fields: [],
    status: 'pending',
    createdAt: 1,
    resolvedAt: null,
  };
}

beforeEach(() => {
  mockUpdateStatus = { state: 'not-available' };
  onStatus.mockClear();
  download.mockClear();
  install.mockClear();
  useUiPrefs.setState({ sidebarView: 'chats', sidebarVisible: false });
  useAutomationsStore.setState({ interactions: [] });
});

describe('NavRail — view selection', () => {
  it('marks the current sidebarView as selected', () => {
    useUiPrefs.setState({ sidebarView: 'tasks' });
    render_();
    expect(screen.getByTestId('shell-rail-tasks')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('shell-rail-chats')).not.toHaveAttribute('aria-pressed');
  });

  it('clicking a view sets sidebarView AND shows the sidebar', () => {
    useUiPrefs.setState({ sidebarView: 'chats', sidebarVisible: false });
    render_();
    fireEvent.click(screen.getByTestId('shell-rail-automations'));
    expect(useUiPrefs.getState().sidebarView).toBe('automations');
    expect(useUiPrefs.getState().sidebarVisible).toBe(true);
  });
});

describe('NavRail — automations pending dot', () => {
  it('shows no dot with nothing pending', () => {
    render_();
    expect(screen.queryByTestId('shell-rail-automations-pending')).toBeNull();
  });

  it('shows the dot when an interaction is pending', () => {
    useAutomationsStore.setState({ interactions: [interaction('i-1')] });
    render_();
    expect(screen.getByTestId('shell-rail-automations-pending')).toBeInTheDocument();
  });
});

describe('NavRail — update button', () => {
  it('renders null while idle', () => {
    mockUpdateStatus = { state: 'not-available' };
    render_();
    expect(screen.queryByTestId('shell-rail-update')).toBeNull();
  });

  it('renders a dot-carrying button once an update is available', () => {
    mockUpdateStatus = { state: 'available', version: '2.0.0' };
    render_();
    const button = screen.getByTestId('shell-rail-update');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(download).toHaveBeenCalledTimes(1);
  });
});
