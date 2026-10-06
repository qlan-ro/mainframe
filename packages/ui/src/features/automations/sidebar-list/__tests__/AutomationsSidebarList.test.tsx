/**
 * AutomationsSidebarList — 2026-10 redesign: no "Open the library" button
 * (there is no library view any more), "New automation" is its own action
 * row, and the open automation's row is highlighted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider } from '@/components/ui/sidebar';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import type { AutomationSummary } from '../../contract';

// SidebarScopeStrip (rendered in the header) reads the project list and owns
// a remove-project action, both of which reach the daemon port — stub the
// list (fast, no network) and supply a provider for the rest.
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [], loading: false, reloadProjects: vi.fn(), removeProjectFromList: vi.fn() }),
}));
import { createFakeGateway as fakeGateway } from '../../data/__tests__/fake-gateway';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { useAutomationsStore } from '../../data/use-automations-store';
import { useSessionFilters } from '@/store/session-filters';
import { AutomationsSidebarList } from '../AutomationsSidebarList';

function render_(ui: React.ReactElement) {
  return render(
    <TooltipProvider>
      <DaemonPortProvider port={0}>
        <SidebarProvider>{ui}</SidebarProvider>
      </DaemonPortProvider>
    </TooltipProvider>,
  );
}

const DEFS: AutomationSummary[] = [
  {
    id: 'a1',
    name: 'Daily standup',
    scope: 'global',
    projectId: null,
    enabled: true,
    definition: { triggers: [], steps: [] },
    createdAt: 1,
    updatedAt: 1,
  },
];

function reset() {
  useSessionFilters.setState({ filterProjectIds: new Set() });
  useAutomationsNav.setState({
    editorTarget: null,
    describeOpen: false,
    detailsAutomationId: null,
    selectedRunId: null,
  });
  useAutomationsStore.setState({
    libraries: {},
    interactions: [],
    gateway: fakeGateway({ listAutomations: async () => DEFS }),
  });
}

afterEach(() => {
  reset();
});

it('has no "Open the library" button any more', async () => {
  reset();
  render_(<AutomationsSidebarList />);
  await screen.findByTestId('automations-sidebar-row-a1');
  expect(screen.queryByTestId('automations-sidebar-open-library')).toBeNull();
});

it('"New automation" is a full action row that opens the editor', async () => {
  reset();
  const user = userEvent.setup();
  render_(<AutomationsSidebarList />);

  const row = screen.getByTestId('automations-sidebar-new');
  expect(row).toHaveTextContent('New automation');
  await user.click(row);
  expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'new' });
});

describe('selected row highlighting', () => {
  it("highlights the open automation's row", async () => {
    reset();
    useAutomationsNav.setState({ detailsAutomationId: 'a1' });
    render_(<AutomationsSidebarList />);

    const row = await screen.findByTestId('automations-sidebar-row-a1');
    await waitFor(() => expect(row).toHaveAttribute('aria-pressed', 'true'));
  });

  it('highlights nothing while a brand-new draft is open', async () => {
    reset();
    useAutomationsNav.setState({ detailsAutomationId: 'a1', editorTarget: { mode: 'new' } });
    render_(<AutomationsSidebarList />);

    const row = await screen.findByTestId('automations-sidebar-row-a1');
    expect(row).toHaveAttribute('aria-pressed', 'false');
  });

  it('highlights the row whose automation is being edited', async () => {
    reset();
    useAutomationsNav.setState({ detailsAutomationId: 'a1', editorTarget: { mode: 'edit', automationId: 'a1' } });
    render_(<AutomationsSidebarList />);

    const row = await screen.findByTestId('automations-sidebar-row-a1');
    expect(row).toHaveAttribute('aria-pressed', 'true');
  });
});
