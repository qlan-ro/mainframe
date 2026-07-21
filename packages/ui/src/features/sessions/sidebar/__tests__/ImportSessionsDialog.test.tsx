/**
 * ImportSessionsDialog — behavior tests.
 *
 * Behaviors covered:
 *  1. When filterProjectId is set (pre-selected), the dialog skips the project
 *     picker and calls getExternalSessions(port, projectId) immediately.
 *  2. Each returned ExternalSession renders an external-session-item row.
 *  3. Clicking import-session-btn calls importExternalSession with the exact
 *     body built from the session's fields, then calls runtime.threads.reload()
 *     (asserted in one test to avoid re-running the render/click setup twice).
 *  4. When filterProjectId is null, the project picker step renders a button
 *     per project keyed by sessions-import-project-<id>.
 *
 * Strategy:
 *  - Mock @assistant-ui/react: useAssistantRuntime() returns a controlled runtime
 *    with a reload spy on threads.
 *  - Mock @/lib/api/external-sessions: getExternalSessions + importExternalSession
 *    are spies.
 *  - Wrap renders in TooltipProvider for Radix tooltip compatibility.
 *  - Use waitFor to let the useEffect + setState settle after the dialog mounts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExternalSession, ExternalSessionPage, Project } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Spies
// ---------------------------------------------------------------------------

const reloadSpy = vi.fn();
const getExternalSessionsSpy = vi.fn();
const importExternalSessionSpy = vi.fn();

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAssistantRuntime: () => ({
    threads: {
      getState: () => ({ threadIds: [], threadItems: {} }),
      reload: reloadSpy,
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/api/external-sessions
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/external-sessions', () => ({
  getExternalSessions: (...args: unknown[]) => getExternalSessionsSpy(...args),
  importExternalSession: (...args: unknown[]) => importExternalSessionSpy(...args),
}));

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are registered
// ---------------------------------------------------------------------------

const { ImportSessionsDialog } = await import('../ImportSessionsDialog');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORT = 31415;

const PROJECT_1: Project = {
  id: 'proj-1',
  name: 'mainframe',
  path: '/projects/mainframe',
  createdAt: '2026-01-01T00:00:00Z',
  lastOpenedAt: '2026-01-01T00:00:00Z',
};

const PROJECT_2: Project = {
  id: 'proj-2',
  name: 'mobile',
  path: '/projects/mobile',
  createdAt: '2026-01-01T00:00:00Z',
  lastOpenedAt: '2026-01-01T00:00:00Z',
};

const EXTERNAL_SESSION: ExternalSession = {
  sessionId: 'ext-sess-001',
  adapterId: 'claude',
  projectPath: '/projects/mainframe',
  cwd: '/projects/mainframe',
  firstPrompt: 'Fix the parser',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-06-01T10:00:00.000Z',
  gitBranch: 'fix/parser',
};

// ---------------------------------------------------------------------------
// Reset per test
// ---------------------------------------------------------------------------

/** Empty page returned when the mock doesn't specify a return value. */
const EMPTY_PAGE: ExternalSessionPage = { sessions: [], total: 0, nextOffset: null };

beforeEach(() => {
  reloadSpy.mockReset();
  reloadSpy.mockResolvedValue(undefined);
  getExternalSessionsSpy.mockReset();
  getExternalSessionsSpy.mockResolvedValue(EMPTY_PAGE);
  importExternalSessionSpy.mockReset();
  importExternalSessionSpy.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Helper — wraps in TooltipProvider for Radix tooltip compatibility
// ---------------------------------------------------------------------------

function renderDialog({ projects, filterProjectId }: { projects: Project[]; filterProjectId: string | null }) {
  render(
    <TooltipProvider>
      <ImportSessionsDialog
        open={true}
        onOpenChange={vi.fn()}
        port={PORT}
        projects={projects}
        filterProjectId={filterProjectId}
      />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// 1. Pre-selected project: skips picker, calls getExternalSessions
// ---------------------------------------------------------------------------

describe('ImportSessionsDialog — with filterProjectId set, calls getExternalSessions', () => {
  it('calls getExternalSessions(31415, "proj-1", opts) when filterProjectId="proj-1" and the dialog opens', async () => {
    getExternalSessionsSpy.mockResolvedValue(EMPTY_PAGE);

    renderDialog({ projects: [PROJECT_1], filterProjectId: 'proj-1' });

    await waitFor(() => {
      expect(getExternalSessionsSpy).toHaveBeenCalledTimes(1);
      expect(getExternalSessionsSpy).toHaveBeenCalledWith(31415, 'proj-1', { offset: 0, limit: 50 });
    });
  });

  it('does not render the project picker when filterProjectId is set', async () => {
    getExternalSessionsSpy.mockResolvedValue(EMPTY_PAGE);

    renderDialog({ projects: [PROJECT_1], filterProjectId: 'proj-1' });

    // The project picker renders buttons keyed sessions-import-project-<id>
    await waitFor(() => {
      expect(screen.queryByTestId('sessions-import-project-proj-1')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. External session rows render
// ---------------------------------------------------------------------------

describe('ImportSessionsDialog — renders one external-session-item per returned session', () => {
  it('renders one external-session-item for a single returned session', async () => {
    getExternalSessionsSpy.mockResolvedValue({ sessions: [EXTERNAL_SESSION], total: 1, nextOffset: null });

    renderDialog({ projects: [PROJECT_1], filterProjectId: 'proj-1' });

    await waitFor(() => {
      expect(screen.getAllByTestId('external-session-item')).toHaveLength(1);
    });
  });

  it('renders two external-session-item elements for two returned sessions', async () => {
    const second: ExternalSession = {
      ...EXTERNAL_SESSION,
      sessionId: 'ext-sess-002',
      firstPrompt: 'Add type safety',
    };
    getExternalSessionsSpy.mockResolvedValue({ sessions: [EXTERNAL_SESSION, second], total: 2, nextOffset: null });

    renderDialog({ projects: [PROJECT_1], filterProjectId: 'proj-1' });

    await waitFor(() => {
      expect(screen.getAllByTestId('external-session-item')).toHaveLength(2);
    });
  });
});

it('calls importExternalSession with the exact body derived from the session, then reloads the thread list', async () => {
  getExternalSessionsSpy.mockResolvedValue({ sessions: [EXTERNAL_SESSION], total: 1, nextOffset: null });

  renderDialog({ projects: [PROJECT_1], filterProjectId: 'proj-1' });

  await waitFor(() => {
    expect(screen.getByTestId('import-session-btn')).toBeTruthy();
  });

  await act(async () => {
    await userEvent.click(screen.getByTestId('import-session-btn'));
  });

  expect(importExternalSessionSpy).toHaveBeenCalledTimes(1);
  expect(importExternalSessionSpy).toHaveBeenCalledWith(31415, 'proj-1', {
    sessionId: 'ext-sess-001',
    adapterId: 'claude',
    title: 'Fix the parser',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-06-01T10:00:00.000Z',
  });
  expect(reloadSpy).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// 4. No filterProjectId: project picker renders a button per project
// ---------------------------------------------------------------------------

describe('ImportSessionsDialog — project picker step when filterProjectId is null', () => {
  it('renders sessions-import-project-<id> button for each project', () => {
    renderDialog({ projects: [PROJECT_1, PROJECT_2], filterProjectId: null });

    expect(screen.getByTestId('sessions-import-project-proj-1')).toBeTruthy();
    expect(screen.getByTestId('sessions-import-project-proj-2')).toBeTruthy();
  });

  it('does not call getExternalSessions before a project is selected', () => {
    renderDialog({ projects: [PROJECT_1], filterProjectId: null });

    expect(getExternalSessionsSpy).not.toHaveBeenCalled();
  });

  it('calls getExternalSessions after clicking a project picker button', async () => {
    getExternalSessionsSpy.mockResolvedValue(EMPTY_PAGE);

    renderDialog({ projects: [PROJECT_1, PROJECT_2], filterProjectId: null });

    await userEvent.click(screen.getByTestId('sessions-import-project-proj-2'));

    await waitFor(() => {
      expect(getExternalSessionsSpy).toHaveBeenCalledTimes(1);
      expect(getExternalSessionsSpy).toHaveBeenCalledWith(31415, 'proj-2', { offset: 0, limit: 50 });
    });
  });
});
