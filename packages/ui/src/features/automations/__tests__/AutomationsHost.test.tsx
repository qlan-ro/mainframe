import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutomationsHost } from '../AutomationsHost';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';

// Project resolution is out of scope here — most tests want the pre-scoping
// "show everything" behavior; the scoping-specific test below overrides it.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: vi.fn(() => ({ projectId: undefined })),
}));

beforeEach(() => {
  vi.mocked(useActiveIdentity).mockReturnValue({ projectId: undefined } as ReturnType<typeof useActiveIdentity>);
  useAutomationsStore.setState({ activeProjectId: null });
});

it('renders nothing while closed', () => {
  useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  const { container } = render(<AutomationsHost />);
  expect(container).toBeEmptyDOMElement();
});

it('loads automations even while closed, so the sidebar badge reflects pending interactions on boot', async () => {
  useAutomationsStore.setState({ definitions: [] });
  useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  render(<AutomationsHost />);

  await vi.waitFor(() => {
    expect(useAutomationsStore.getState().definitions.length).toBe(6);
  });
});

it('renders the view once opened, and loads automations from the gateway', async () => {
  useAutomationsStore.setState({ definitions: [] });
  useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
  render(<AutomationsHost />);

  expect(screen.getByTestId('automations-host')).toBeInTheDocument();
  expect(await screen.findByTestId('automations-view')).toBeInTheDocument();
  expect(useAutomationsStore.getState().definitions.length).toBe(6);
});

it('clicking the backdrop closes the host', () => {
  useAutomationsStore.setState({ definitions: [] });
  useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
  render(<AutomationsHost />);
  fireEvent.click(screen.getByTestId('automations-host'));
  expect(useAutomationsNav.getState().open).toBe(false);
});

it('resolves the active project via useActiveIdentity into the store, scoping the library to it', async () => {
  vi.mocked(useActiveIdentity).mockReturnValue({ projectId: 'proj-1' } as ReturnType<typeof useActiveIdentity>);
  useAutomationsStore.setState({ definitions: [] });
  useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  render(<AutomationsHost />);

  await vi.waitFor(() => {
    expect(useAutomationsStore.getState().activeProjectId).toBe('proj-1');
  });
  // None of the seeded fixtures belong to 'proj-1' — the scoped load should
  // resolve to an empty list rather than every automation in the workspace.
  expect(useAutomationsStore.getState().definitions).toEqual([]);
});
