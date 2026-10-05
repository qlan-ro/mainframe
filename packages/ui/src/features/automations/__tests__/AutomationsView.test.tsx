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

import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { useSessionFilters } from '@/store/session-filters';
import { EMPTY_LIBRARY, type LibraryEntry } from '../data/library-cache';

/** D7: AutomationsView reads the D7 scope hook, 'all' since no test here scopes the session filters. */
function seedLibrary(patch: Partial<LibraryEntry>) {
  useAutomationsStore.setState((s) => ({
    libraries: { ...s.libraries, all: { ...EMPTY_LIBRARY, ...s.libraries.all, ...patch } },
  }));
}

function reset() {
  useSessionFilters.setState({ filterProjectIds: new Set() });
  useAutomationsNav.setState({ editorTarget: null, runId: null, describeOpen: false, detailsAutomationId: null });
}

it('renders the header and the count; no back button at the bare library', () => {
  reset();
  seedLibrary({ definitions: [] });
  useAutomationsStore.setState({ interactions: [] });
  render(<AutomationsView />);

  expect(screen.getByText('Workflows')).toBeInTheDocument();
  expect(screen.getByTestId('automations-title-count')).toHaveTextContent('0 automations');
  expect(screen.queryByTestId('automations-close')).toBeNull();
});

it('back button appears in a sub-view and returns to the library without leaving the surface', () => {
  reset();
  seedLibrary({ definitions: [] });
  useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
  render(<AutomationsView />);

  fireEvent.click(screen.getByTestId('automations-close'));
  const nav = useAutomationsNav.getState();
  expect(nav.editorTarget).toBeNull();
});

it('shows the library section by default, listing loaded definitions', () => {
  reset();
  seedLibrary({
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
  render(<AutomationsView />);

  expect(screen.getByTestId('automations-section-library')).toBeInTheDocument();
  expect(screen.getByTestId('automations-library-row-a1')).toHaveTextContent('Daily standup');
});

it('shows the (lazy-loaded) editor section when an editor target is open', async () => {
  reset();
  seedLibrary({ definitions: [] });
  useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
  render(<AutomationsView />);
  // AutomationEditor is React.lazy — the Suspense boundary swaps its whole
  // subtree (including this wrapper div) for the fallback until the chunk
  // resolves, so this assertion must await it rather than getByTestId.
  expect(await screen.findByTestId('automations-section-editor')).toBeInTheDocument();
});

it('shows the (lazy-loaded) run section when a run id is open, taking precedence over the editor', async () => {
  reset();
  seedLibrary({ definitions: [], runs: [] });
  useAutomationsNav.setState({ editorTarget: { mode: 'new' }, runId: 'r1' });
  render(<AutomationsView />);
  // RunView is React.lazy too — same Suspense-swap reasoning as the editor test above.
  expect(await screen.findByTestId('automations-section-run')).toBeInTheDocument();
});

it('shows the describe section when describeOpen is set, below run/editor precedence', () => {
  reset();
  seedLibrary({ definitions: [], runs: [] });
  useAutomationsStore.setState({ catalog: [] });
  useAutomationsNav.setState({ describeOpen: true });
  render(<AutomationsView />);
  expect(screen.getByTestId('automations-section-describe')).toBeInTheDocument();
});

it('shows the (lazy-loaded) details section when a details target is open, below run/editor/describe precedence', async () => {
  reset();
  seedLibrary({
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
  });
  useAutomationsStore.setState({ catalog: [] });
  useAutomationsNav.setState({ detailsAutomationId: 'a1' });
  render(<AutomationsView />);
  expect(await screen.findByTestId('automations-section-details')).toBeInTheDocument();
});
