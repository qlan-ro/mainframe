import { it, expect, vi } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AutomationsView } from '../AutomationsView';

// The library row's project annotation fetches through the daemon port — inert here.
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [{ id: 'proj-1', name: 'Mainframe' }] }),
}));

// The header's Hint needs the v2 TooltipProvider; the app mounts one at the
// root (via SidebarProvider), so the test supplies its own.
function render(ui: React.ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

// The scope is the host's, so every render here supplies it.
function renderView(overrides: Partial<React.ComponentProps<typeof AutomationsView>> = {}) {
  return render(<AutomationsView projectId="proj-1" onProjectChange={vi.fn()} {...overrides} />);
}
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';

it('renders the header, the count, and closes via the close button', () => {
  useAutomationsStore.setState({ definitions: [], interactions: [] });
  useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
  renderView();

  expect(screen.getByText('Workflows')).toBeInTheDocument();
  expect(screen.getByTestId('automations-title-count')).toHaveTextContent('0 automations');

  fireEvent.click(screen.getByTestId('automations-close'));
  expect(useAutomationsNav.getState().open).toBe(false);
});

it('shows the library section by default, listing loaded definitions', () => {
  useAutomationsNav.setState({ editorTarget: null, runId: null });
  useAutomationsStore.setState({
    definitions: [
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
    ],
  });
  renderView();

  expect(screen.getByTestId('automations-section-library')).toBeInTheDocument();
  expect(screen.getByTestId('automations-library-row-a1')).toHaveTextContent('Daily standup');
});

it('shows the (lazy-loaded) editor section when an editor target is open', async () => {
  useAutomationsStore.setState({ definitions: [] });
  useAutomationsNav.setState({ editorTarget: { mode: 'new' }, runId: null });
  renderView();
  // AutomationEditor is React.lazy — the Suspense boundary swaps its whole
  // subtree (including this wrapper div) for the fallback until the chunk
  // resolves, so this assertion must await it rather than getByTestId.
  expect(await screen.findByTestId('automations-section-editor')).toBeInTheDocument();
});

it('shows the (lazy-loaded) run section when a run id is open, taking precedence over the editor', async () => {
  useAutomationsStore.setState({ definitions: [], runs: [] });
  useAutomationsNav.setState({ editorTarget: { mode: 'new' }, runId: 'r1' });
  renderView();
  // RunView is React.lazy too — same Suspense-swap reasoning as the editor test above.
  expect(await screen.findByTestId('automations-section-run')).toBeInTheDocument();
});

it('shows the describe section when describeOpen is set, below run/editor precedence', () => {
  useAutomationsStore.setState({ definitions: [], runs: [], catalog: [] });
  useAutomationsNav.setState({ editorTarget: null, runId: null, describeOpen: true, detailsAutomationId: null });
  renderView();
  expect(screen.getByTestId('automations-section-describe')).toBeInTheDocument();
});

it('shows the (lazy-loaded) details section when a details target is open, below run/editor/describe precedence', async () => {
  useAutomationsStore.setState({
    definitions: [
      {
        id: 'a1',
        name: 'Daily standup',
        scope: 'project',
        projectId: 'proj-1',
        enabled: true,
        definition: { triggers: [], steps: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    runs: [],
    catalog: [],
  });
  useAutomationsNav.setState({
    editorTarget: null,
    runId: null,
    describeOpen: false,
    detailsAutomationId: 'a1',
  });
  renderView();
  expect(await screen.findByTestId('automations-section-details')).toBeInTheDocument();
});

it('names the scoped project in the header and hands a pick back to the host', () => {
  useAutomationsStore.setState({ definitions: [], interactions: [] });
  useAutomationsNav.setState({
    open: true,
    editorTarget: null,
    runId: null,
    describeOpen: false,
    detailsAutomationId: null,
  });
  const onProjectChange = vi.fn();
  renderView({ onProjectChange });

  const picker = screen.getByTestId('automations-project-picker');
  expect(picker).toHaveTextContent('Mainframe');

  // Radix DropdownMenu opens on pointer events, which a real click also fires.
  fireEvent.pointerDown(picker, { button: 0 });
  fireEvent.pointerUp(picker);
  fireEvent.click(screen.getByTestId('automations-project-all'));

  expect(onProjectChange).toHaveBeenCalledWith(null);
});

it('leaves the picker inoperable while a sub-view owns the modal', async () => {
  useAutomationsStore.setState({ definitions: [], catalog: [] });
  useAutomationsNav.setState({
    open: true,
    editorTarget: { mode: 'new' },
    runId: null,
    describeOpen: false,
    detailsAutomationId: null,
  });
  renderView();

  expect(await screen.findByTestId('automations-section-editor')).toBeInTheDocument();
  expect(screen.getByTestId('automations-project-picker')).toBeDisabled();
});
