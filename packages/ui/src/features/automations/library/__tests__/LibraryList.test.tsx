/**
 * LibraryList — row list wired to the store, New button, and BlankState with
 * both creation paths when the library is empty. TDD: test written first,
 * component implemented after.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AutomationRunSummary, AutomationSummary } from '../../contract';
import { useAutomationsStore } from '../../data/use-automations-store';
import { EMPTY_LIBRARY, type LibraryEntry } from '../../data/library-cache';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { LibraryList } from '../LibraryList';

/** Seeds the modal's scope entry ('all' unless `scopeProjectId` is set). */
function setLibrary(patch: Partial<LibraryEntry>, scope = 'all') {
  useAutomationsStore.setState((s) => ({ libraries: { ...s.libraries, [scope]: { ...EMPTY_LIBRARY, ...patch } } }));
}

// The row's project annotation fetches through the daemon port — inert here.
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [{ id: 'proj-1', name: 'Mainframe' }] }),
}));

const DEFAULT_LOAD_LIBRARY = useAutomationsStore.getState().loadLibrary;

const AUTOMATION_A: AutomationSummary = {
  id: 'auto-a',
  name: 'Daily standup',
  scope: 'global',
  projectId: null,
  enabled: true,
  definition: { triggers: [], steps: [] },
  createdAt: 1,
  updatedAt: 1,
};

const AUTOMATION_B: AutomationSummary = {
  id: 'auto-b',
  name: 'Ship work',
  scope: 'project',
  projectId: 'proj-1',
  enabled: true,
  definition: { triggers: [], steps: [] },
  createdAt: 2,
  updatedAt: 2,
};

describe('LibraryList', () => {
  beforeEach(() => {
    useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
    useAutomationsStore.setState({
      libraries: {},
      scopeProjectId: null,
      loadLibrary: DEFAULT_LOAD_LIBRARY,
    });
  });

  it('renders a row per definition, keyed by automation id', () => {
    setLibrary({ definitions: [AUTOMATION_A, AUTOMATION_B], runs: [] });
    render(<LibraryList />);

    expect(screen.getByTestId('automations-library-row-auto-a')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-row-auto-b')).toBeInTheDocument();
  });

  it('passes each row its most recent run', () => {
    const runs: AutomationRunSummary[] = [
      {
        id: 'run-old',
        automationId: 'auto-a',
        status: 'failed',
        trigger: { kind: 'manual' },
        startedAt: 1,
        finishedAt: 2,
        error: 'boom',
      },
      {
        id: 'run-new',
        automationId: 'auto-a',
        status: 'succeeded',
        trigger: { kind: 'manual' },
        startedAt: 100,
        finishedAt: 110,
        error: null,
      },
    ];
    setLibrary({ definitions: [AUTOMATION_A], runs });
    render(<LibraryList />);

    expect(screen.getByTestId('automations-library-last-run-auto-a')).toHaveTextContent('Done');
  });

  it('clicking New opens the editor in "new" mode', () => {
    setLibrary({ definitions: [AUTOMATION_A], runs: [] });
    render(<LibraryList />);

    fireEvent.click(screen.getByTestId('automations-library-new'));

    expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'new' });
  });

  it('shows BlankState with both creation paths when there are no definitions', () => {
    setLibrary({ definitions: [], runs: [] });
    render(<LibraryList />);

    expect(screen.queryByTestId('automations-library-new')).not.toBeInTheDocument();
    expect(screen.getByTestId('automations-blank-describe')).toBeInTheDocument();
    expect(screen.getByTestId('automations-blank-build')).toBeInTheDocument();
  });

  it('shows an error banner with retry above the rows when a fetch failed but automations exist', () => {
    let retried = 0;
    setLibrary({ definitions: [AUTOMATION_A], runs: [], error: 'run history unavailable' });
    useAutomationsStore.setState({
      loadLibrary: async () => {
        retried += 1;
      },
    });
    render(<LibraryList />);

    // The library still renders its rows — the failure must not eat the list.
    expect(screen.getByTestId(`automations-library-row-${AUTOMATION_A.id}`)).toBeInTheDocument();
    const banner = screen.getByTestId('automations-library-error-banner');
    expect(banner).toHaveTextContent('run history unavailable');

    fireEvent.click(screen.getByTestId('automations-library-error-retry'));
    expect(retried).toBe(1);
  });

  it('"Build it" on the blank state opens the editor in "new" mode', () => {
    setLibrary({ definitions: [], runs: [] });
    render(<LibraryList />);

    fireEvent.click(screen.getByTestId('automations-blank-build'));

    expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'new' });
  });

  it('"Describe it" on the blank state is disabled while the describe flow is unshipped', () => {
    setLibrary({ definitions: [], runs: [] });
    render(<LibraryList />);

    const describeButton = screen.getByTestId('automations-blank-describe');
    expect(describeButton).toBeDisabled();

    fireEvent.click(describeButton);
    expect(useAutomationsNav.getState().editorTarget).toBeNull();
  });

  it('shows a loading state instead of BlankState while the initial fetch is in flight', () => {
    setLibrary({ definitions: [], runs: [], loading: true });
    render(<LibraryList />);

    expect(screen.getByTestId('automations-library-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-blank-describe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('automations-blank-build')).not.toBeInTheDocument();
  });

  it('shows an inline error with retry instead of BlankState when the fetch fails', () => {
    const loadLibrarySpy = vi.fn().mockResolvedValue(undefined);
    setLibrary({ definitions: [], runs: [], loading: false, error: 'Network unreachable' }, 'proj-1');
    useAutomationsStore.setState({
      scopeProjectId: 'proj-1',
      loadLibrary: loadLibrarySpy,
    });
    render(<LibraryList />);

    expect(screen.getByTestId('automations-library-error')).toHaveTextContent('Network unreachable');
    expect(screen.queryByTestId('automations-blank-describe')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('automations-library-retry'));
    // Retry re-reads the project the modal is scoped to, not "everything".
    expect(loadLibrarySpy).toHaveBeenCalledExactlyOnceWith('proj-1');
  });

  it('renders the row list, not the loading/error/blank states, once data has loaded', () => {
    setLibrary({ definitions: [AUTOMATION_A], runs: [], loading: false, error: null });
    render(<LibraryList />);

    expect(screen.getByTestId('automations-library-row-auto-a')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-library-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('automations-library-error')).not.toBeInTheDocument();
  });
});
