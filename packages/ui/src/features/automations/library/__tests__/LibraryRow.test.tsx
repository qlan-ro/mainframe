/**
 * LibraryRow — name/description/project badge/trigger chips, last-run pill,
 * toggle, Run now, Edit, Delete. TDD: test written first, component
 * implemented after.
 *
 * `useProjects` (which needs a DaemonPortProvider), the confirm bridge and the
 * toaster are mocked: the row's behavior is what it does with their answers,
 * not their own plumbing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { requestConfirm } from '@/lib/confirm-bridge';
import { mfToast } from '@/lib/toast';
import type { AutomationRunSummary, AutomationSummary } from '../../contract';
import { createFakeGateway as fakeGateway } from '../../data/__tests__/fake-gateway';
import { useAutomationsStore } from '../../data/use-automations-store';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { LibraryRow } from '../LibraryRow';

vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [{ id: 'proj-1', name: 'Mainframe' }] }),
}));
vi.mock('@/lib/confirm-bridge', () => ({ requestConfirm: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const AUTOMATION: AutomationSummary = {
  id: 'auto-1',
  name: 'Daily standup',
  description: 'Summarizes yesterday and pings me',
  scope: 'project',
  projectId: 'proj-1',
  enabled: true,
  definition: {
    triggers: [{ id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '08:00' }, onMissed: 'skip' }],
    steps: [],
  },
  createdAt: 1,
  updatedAt: 1,
};

const RUN: AutomationRunSummary = {
  id: 'run-1',
  automationId: 'auto-1',
  status: 'succeeded',
  trigger: { kind: 'schedule' },
  startedAt: Date.now() - 60_000,
  finishedAt: Date.now() - 55_000,
  error: null,
};

describe('LibraryRow', () => {
  beforeEach(() => {
    useAutomationsStore.setState({ definitions: [AUTOMATION], runs: [], gateway: fakeGateway() });
    useAutomationsNav.setState({ open: true, editorTarget: null, runId: null, detailsAutomationId: null });
    vi.mocked(requestConfirm).mockReset();
    vi.mocked(mfToast.error).mockReset();
  });

  it('renders name, description, and trigger chip', () => {
    render(<LibraryRow automation={AUTOMATION} />);

    const row = screen.getByTestId('automations-library-row-auto-1');
    expect(row).toHaveTextContent('Daily standup');
    expect(row).toHaveTextContent('Summarizes yesterday and pings me');
    expect(row).toHaveTextContent('Every day at 08:00');
  });

  it('renders no scope badge — every automation is project-scoped, so it carries no information', () => {
    render(<LibraryRow automation={AUTOMATION} />);
    const row = screen.getByTestId('automations-library-row-auto-1');
    expect(row).not.toHaveTextContent('Project');
    expect(row).not.toHaveTextContent('Global');
  });

  it('renders a chip per trigger when there are several', () => {
    render(
      <LibraryRow
        automation={{
          ...AUTOMATION,
          definition: {
            ...AUTOMATION.definition,
            triggers: [
              { id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '08:00' }, onMissed: 'skip' },
              { id: 't2', kind: 'event', event: 'session.finished' },
            ],
          },
        }}
      />,
    );
    const row = screen.getByTestId('automations-library-row-auto-1');
    expect(row).toHaveTextContent('Every day at 08:00');
    expect(row).toHaveTextContent('When a chat session finishes');
  });

  it('shows "Never run" when there is no last run', () => {
    render(<LibraryRow automation={AUTOMATION} />);
    expect(screen.getByTestId('automations-library-last-run-auto-1')).toHaveTextContent('Never run');
  });

  it('shows the last run status and opens the run view on click', () => {
    render(<LibraryRow automation={AUTOMATION} lastRun={RUN} />);

    const pill = screen.getByTestId('automations-library-last-run-auto-1');
    expect(pill).toHaveTextContent('Done');

    fireEvent.click(pill);
    expect(useAutomationsNav.getState().runId).toBe('run-1');
  });

  it('toggling the switch calls gateway.setEnabled and patches the definition', async () => {
    const updated: AutomationSummary = { ...AUTOMATION, enabled: false };
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        setEnabled: async (id, enabled) => {
          expect(id).toBe('auto-1');
          expect(enabled).toBe(false);
          return updated;
        },
      }),
    );
    render(<LibraryRow automation={AUTOMATION} />);

    fireEvent.click(screen.getByTestId('automations-library-toggle-auto-1'));

    await waitFor(() => {
      expect(useAutomationsStore.getState().definitions).toEqual([updated]);
    });
  });

  it('"Run now" starts a run via the gateway and opens it', async () => {
    const newRun: AutomationRunSummary = { ...RUN, id: 'run-new', status: 'running' };
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        startRun: async (id) => {
          expect(id).toBe('auto-1');
          return newRun;
        },
      }),
    );
    render(<LibraryRow automation={AUTOMATION} />);

    fireEvent.click(screen.getByTestId('automations-library-run-auto-1'));

    await waitFor(() => {
      expect(useAutomationsNav.getState().runId).toBe('run-new');
    });
    expect(useAutomationsStore.getState().runs).toEqual([newRun]);
  });

  it('Edit navigates to the editor for this automation', () => {
    render(<LibraryRow automation={AUTOMATION} />);

    fireEvent.click(screen.getByTestId('automations-library-edit-auto-1'));

    expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'edit', automationId: 'auto-1' });
  });

  describe('clicking the row (todo #233 — navigate to details)', () => {
    it('opens the run view directly when the automation has exactly one run', () => {
      useAutomationsStore.setState({ runs: [RUN] });
      render(<LibraryRow automation={AUTOMATION} lastRun={RUN} />);

      fireEvent.click(screen.getByTestId('automations-library-row-auto-1'));

      expect(useAutomationsNav.getState().runId).toBe('run-1');
      expect(useAutomationsNav.getState().detailsAutomationId).toBeNull();
    });

    it('opens details when the automation has more than one run', () => {
      const secondRun: AutomationRunSummary = { ...RUN, id: 'run-2', startedAt: RUN.startedAt - 1000 };
      useAutomationsStore.setState({ runs: [RUN, secondRun] });
      render(<LibraryRow automation={AUTOMATION} lastRun={RUN} />);

      fireEvent.click(screen.getByTestId('automations-library-row-auto-1'));

      expect(useAutomationsNav.getState().detailsAutomationId).toBe('auto-1');
      expect(useAutomationsNav.getState().runId).toBeNull();
    });

    it('opens details when the automation has never run', () => {
      render(<LibraryRow automation={AUTOMATION} />);

      fireEvent.click(screen.getByTestId('automations-library-row-auto-1'));

      expect(useAutomationsNav.getState().detailsAutomationId).toBe('auto-1');
    });

    it('does not fire row navigation when clicking Run, Edit, or the toggle', () => {
      render(<LibraryRow automation={AUTOMATION} />);

      fireEvent.click(screen.getByTestId('automations-library-edit-auto-1'));
      expect(useAutomationsNav.getState().detailsAutomationId).toBeNull();
      expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'edit', automationId: 'auto-1' });

      useAutomationsNav.setState({ editorTarget: null });
      fireEvent.click(screen.getByTestId('automations-library-toggle-auto-1'));
      expect(useAutomationsNav.getState().detailsAutomationId).toBeNull();
    });

    it('does not fire row navigation when clicking the last-run pill', () => {
      const secondRun: AutomationRunSummary = { ...RUN, id: 'run-2', startedAt: RUN.startedAt - 1000 };
      useAutomationsStore.setState({ runs: [RUN, secondRun] });
      render(<LibraryRow automation={AUTOMATION} lastRun={RUN} />);

      fireEvent.click(screen.getByTestId('automations-library-last-run-auto-1'));

      // The pill's own handler opens the specific run it shows, not the
      // row's "several runs → details" routing.
      expect(useAutomationsNav.getState().runId).toBe('run-1');
      expect(useAutomationsNav.getState().detailsAutomationId).toBeNull();
    });
  });

  describe('project badge', () => {
    it("names the automation's own project", () => {
      render(<LibraryRow automation={AUTOMATION} />);
      expect(screen.getByTestId('automations-library-project-auto-1')).toHaveTextContent('Mainframe');
    });

    it('says "All projects" for an unscoped automation', () => {
      render(<LibraryRow automation={{ ...AUTOMATION, projectId: null }} />);
      expect(screen.getByTestId('automations-library-project-auto-1')).toHaveTextContent('All projects');
    });

    it('falls back to the raw id for a project the list does not know', () => {
      render(<LibraryRow automation={{ ...AUTOMATION, projectId: 'proj-ghost' }} />);
      expect(screen.getByTestId('automations-library-project-auto-1')).toHaveTextContent('proj-ghost');
    });
  });

  describe('Delete', () => {
    it('asks for a destructive confirmation naming the automation, then deletes it', async () => {
      const deleteAutomation = vi.fn(async () => {});
      useAutomationsStore.getState().setGateway(fakeGateway({ deleteAutomation }));
      vi.mocked(requestConfirm).mockResolvedValue(true);
      render(<LibraryRow automation={AUTOMATION} />);

      fireEvent.click(screen.getByTestId('automations-library-delete-auto-1'));

      await waitFor(() => {
        expect(useAutomationsStore.getState().definitions).toEqual([]);
      });
      expect(deleteAutomation).toHaveBeenCalledWith('auto-1');
      expect(requestConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delete "Daily standup"?', destructive: true }),
      );
    });

    it('deletes nothing when the confirmation is cancelled', async () => {
      const deleteAutomation = vi.fn(async () => {});
      useAutomationsStore.getState().setGateway(fakeGateway({ deleteAutomation }));
      vi.mocked(requestConfirm).mockResolvedValue(false);
      render(<LibraryRow automation={AUTOMATION} />);

      fireEvent.click(screen.getByTestId('automations-library-delete-auto-1'));

      await waitFor(() => {
        expect(requestConfirm).toHaveBeenCalledTimes(1);
      });
      expect(deleteAutomation).not.toHaveBeenCalled();
      expect(useAutomationsStore.getState().definitions).toEqual([AUTOMATION]);
    });

    it('keeps the row and toasts when the gateway rejects', async () => {
      useAutomationsStore.getState().setGateway(
        fakeGateway({
          deleteAutomation: async () => {
            throw new Error('daemon offline');
          },
        }),
      );
      vi.mocked(requestConfirm).mockResolvedValue(true);
      render(<LibraryRow automation={AUTOMATION} />);

      fireEvent.click(screen.getByTestId('automations-library-delete-auto-1'));

      await waitFor(() => {
        expect(mfToast.error).toHaveBeenCalledWith('Could not delete the automation', {
          description: 'daemon offline',
        });
      });
      expect(useAutomationsStore.getState().definitions).toEqual([AUTOMATION]);
    });
  });

  it('keys every interactive testid off the automation id, not an array index', () => {
    render(<LibraryRow automation={{ ...AUTOMATION, id: 'zz-42' }} />);

    expect(screen.getByTestId('automations-library-row-zz-42')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-run-zz-42')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-edit-zz-42')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-delete-zz-42')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-toggle-zz-42')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-project-zz-42')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-last-run-zz-42')).toBeInTheDocument();
  });
});
