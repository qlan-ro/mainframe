import { it, expect, vi } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AutomationsView } from '../AutomationsView';

// The editor's project picker fetches through the daemon port — inert here.
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
  useAutomationsNav.setState({
    editorTarget: null,
    describeOpen: false,
    detailsAutomationId: null,
    selectedRunId: null,
  });
}

it('shows the two creation cards when the scope has no automations at all', () => {
  reset();
  seedLibrary({ definitions: [] });
  render(<AutomationsView />);

  expect(screen.getByTestId('automations-blank')).toBeInTheDocument();
  expect(screen.queryByTestId('automations-empty')).toBeNull();
});

it('shows a quiet "select an automation" prompt (not the cards) once the scope has at least one', () => {
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

  expect(screen.getByTestId('automations-empty')).toBeInTheDocument();
  expect(screen.queryByTestId('automations-blank')).toBeNull();
});

it('"New automation" in the empty state opens the editor', () => {
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

  fireEvent.click(screen.getByTestId('automations-empty-new'));
  expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'new' });
});

it('renders no header row at the empty state', () => {
  reset();
  seedLibrary({ definitions: [] });
  render(<AutomationsView />);
  expect(screen.queryByTestId('automations-close')).toBeNull();
});

it('shows the (lazy-loaded) editor section when an editor target is open, with no outer header row', async () => {
  reset();
  seedLibrary({ definitions: [] });
  useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
  render(<AutomationsView />);
  // AutomationEditor is React.lazy — the Suspense boundary swaps its whole
  // subtree (including this wrapper div) for the fallback until the chunk
  // resolves, so this assertion must await it rather than getByTestId.
  expect(await screen.findByTestId('automations-section-editor')).toBeInTheDocument();
});

it('shows the describe section when describeOpen is set, below the editor precedence', () => {
  reset();
  seedLibrary({ definitions: [], runs: [] });
  useAutomationsStore.setState({ catalog: [] });
  useAutomationsNav.setState({ describeOpen: true });
  render(<AutomationsView />);
  expect(screen.getByTestId('automations-section-describe')).toBeInTheDocument();
});

it('shows the (lazy-loaded) details section when a details target is open, below editor/describe precedence', async () => {
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
