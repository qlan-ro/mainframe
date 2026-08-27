import { it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { AutomationsHost } from '../AutomationsHost';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { createFixtureGateway } from '../fixtures/fixture-gateway';
import { useSessionFilters } from '@/store/session-filters';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';

// The scope hook reads the active session's project as its second seed source;
// most tests here want it unresolved so the seed falls through to the sole
// project below.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: vi.fn(() => ({ projectId: undefined })),
}));

// Feeds both the library row's project annotation and the scope hook's seed —
// one project, so `seedProjectScope`'s sole-project branch resolves 'proj-1'.
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [{ id: 'proj-1', name: 'Mainframe' }], reloadProjects: vi.fn() }),
}));

/** Records every project the library load asks for, real gateway behind it. */
function spyGateway(calls: (string | null | undefined)[]) {
  const base = createFixtureGateway();
  return {
    ...base,
    listAutomations: async (projectId?: string | null) => {
      calls.push(projectId);
      return base.listAutomations(projectId);
    },
  };
}

beforeEach(() => {
  vi.mocked(useActiveIdentity).mockReturnValue({ projectId: undefined } as ReturnType<typeof useActiveIdentity>);
  useSessionFilters.setState({ filterProjectIds: new Set() });
  // The store is module-global: a spy left installed by one test would answer
  // for every later one.
  useAutomationsStore.setState({ scopeProjectId: null, gateway: createFixtureGateway() });
});

it('renders nothing while closed', () => {
  useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  const { container } = render(
    <TooltipProvider>
      <AutomationsHost />
    </TooltipProvider>,
  );
  expect(container).toBeEmptyDOMElement();
});

it('loads interactions even while closed, so the sidebar badge is populated on boot', async () => {
  useAutomationsStore.setState({ interactions: [] });
  useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  render(
    <TooltipProvider>
      <AutomationsHost />
    </TooltipProvider>,
  );

  await vi.waitFor(() => {
    expect(useAutomationsStore.getState().interactions.length).toBeGreaterThan(0);
  });
});

it('renders the view once opened and loads the seeded project’s library', async () => {
  const calls: (string | null | undefined)[] = [];
  useAutomationsStore.setState({ definitions: [], gateway: spyGateway(calls) });
  useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
  render(
    <TooltipProvider>
      <AutomationsHost />
    </TooltipProvider>,
  );

  expect(screen.getByTestId('automations-host')).toBeInTheDocument();
  expect(await screen.findByTestId('automations-view')).toBeInTheDocument();
  // Exactly one call, for the seeded project: the hook now seeds during
  // render, so the opening commit already carries the resolved scope — no
  // wasted unscoped `listAutomations(null)` before it.
  await vi.waitFor(() => expect(calls).toEqual(['proj-1']));
  // No fixture carries a project, so the scoped read comes back empty.
  await vi.waitFor(() => expect(useAutomationsStore.getState().definitions).toEqual([]));
});

it('dismissing the dialog closes the host', () => {
  useAutomationsStore.setState({ definitions: [] });
  useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
  render(
    <TooltipProvider>
      <AutomationsHost />
    </TooltipProvider>,
  );
  // Radix owns dismissal now (backdrop click and Escape both route through
  // onOpenChange); Escape is the deterministic path in jsdom.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(useAutomationsNav.getState().open).toBe(false);
});

it('holds no scope while closed, whatever the active session does, and takes the seed on open', async () => {
  const calls: (string | null | undefined)[] = [];
  useAutomationsStore.setState({ definitions: [], interactions: [], gateway: spyGateway(calls) });
  useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  render(
    <TooltipProvider>
      <AutomationsHost />
    </TooltipProvider>,
  );

  // The badge load proves the host's effects have flushed.
  await vi.waitFor(() => expect(useAutomationsStore.getState().interactions.length).toBeGreaterThan(0));
  act(() => {
    vi.mocked(useActiveIdentity).mockReturnValue({ projectId: 'proj-1' } as ReturnType<typeof useActiveIdentity>);
    useSessionFilters.setState({ filterProjectIds: new Set(['proj-1']) });
  });
  expect(useAutomationsStore.getState().scopeProjectId).toBeNull();
  expect(calls).toEqual([]);
  expect(useAutomationsStore.getState().definitions).toEqual([]);

  act(() => {
    useAutomationsNav.setState({ open: true });
  });

  await vi.waitFor(() => expect(useAutomationsStore.getState().scopeProjectId).toBe('proj-1'));
  expect(calls).toContain('proj-1');
});
