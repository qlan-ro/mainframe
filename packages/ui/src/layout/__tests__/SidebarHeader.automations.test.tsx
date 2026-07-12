/**
 * SidebarHeader — Workflows button entry swap (Phase 6): the button now
 * opens Automations v2 (`useAutomationsNav`) instead of dispatching the v1
 * `mf:open-workflows` DOM event, and its pending-dot badge is sourced from
 * `useAutomationsStore`'s pending-interaction count instead of the v1
 * workflows store. User-facing copy/testid stay "Workflows" (contract:
 * label stays "Workflows" while code/routes/testids say `automations`).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { useAutomationsNav } from '@/features/automations/data/use-automations-nav';
import { useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { SidebarHeader } from '../SidebarHeader';

function renderHeader() {
  return render(
    <HostProvider host={new FakeHostBridge()}>
      <SidebarHeader />
    </HostProvider>,
  );
}

const PENDING_INTERACTION = {
  id: 'int-1',
  runId: 'run-1',
  stepRef: 'ask-1',
  title: 'Pick one',
  fields: [],
  status: 'pending' as const,
  createdAt: 1,
  resolvedAt: null,
};

beforeEach(() => {
  useAutomationsNav.setState({ open: false, editorTarget: null, runId: null, describeOpen: false });
  useAutomationsStore.setState({ interactions: [] });
});

describe('SidebarHeader — Workflows button opens Automations v2', () => {
  it('clicking the button opens the automations host (useAutomationsNav)', () => {
    renderHeader();
    fireEvent.click(screen.getByTestId('sidebar-workflows-button'));
    expect(useAutomationsNav.getState().open).toBe(true);
  });

  it('shows no pending badge when there are no pending automation interactions', () => {
    renderHeader();
    expect(screen.queryByTestId('sidebar-workflows-badge')).toBeNull();
  });

  it('shows the pending badge when the automations store has pending interactions', () => {
    useAutomationsStore.setState({ interactions: [PENDING_INTERACTION] });
    renderHeader();
    expect(screen.getByTestId('sidebar-workflows-badge')).toBeInTheDocument();
  });
});
