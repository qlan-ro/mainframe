/**
 * SessionsMoreMenu — behavior tests.
 *
 * Behaviors covered:
 *  1. data-testid="sessions-more-button" is present on render.
 *  2. Clicking the trigger opens the menu showing "sessions-more-import" and
 *     "sessions-more-archived".
 *  3. "sessions-more-import" is disabled when useProjects returns no projects.
 *  4. "sessions-more-import" is enabled when at least one project exists.
 *  5. "sessions-more-archived" is never disabled, project state notwithstanding.
 *
 * Strategy:
 *  - Mock @assistant-ui/react (component never uses it directly, but
 *    ImportSessionsDialog / ArchivedSessionsDialog do — both are stubbed so the
 *    dialogs never mount).
 *  - Mock ../../use-projects so the project list is controlled per test.
 *  - Mock @/store/session-filters so filterProjectId is controlled.
 *  - Mock ../../runtime/daemon-port-context for useDaemonPort.
 *  - Stub ImportSessionsDialog and ArchivedSessionsDialog to null so their own
 *    deep dependency trees (getExternalSessions, useAssistantRuntime etc.) are
 *    never exercised here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Mutable control state — set per test before rendering
// ---------------------------------------------------------------------------

let __projects: Project[] = [];
let __filterProjectId: string | null = null;

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAssistantRuntime: () => ({
    threads: {
      getState: () => ({ threadIds: [], threadItems: {} }),
      reload: vi.fn(),
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock ../../use-projects
// ---------------------------------------------------------------------------

vi.mock('../../use-projects', () => ({
  useProjects: () => ({ projects: __projects, loading: false }),
}));

// ---------------------------------------------------------------------------
// Mock @/store/session-filters
// ---------------------------------------------------------------------------

vi.mock('@/store/session-filters', () => ({
  useSessionFilters: () => ({
    filterProjectId: __filterProjectId,
  }),
}));

// ---------------------------------------------------------------------------
// Mock ../../runtime/daemon-port-context
// ---------------------------------------------------------------------------

vi.mock('../../runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

// ---------------------------------------------------------------------------
// Stub the two dialogs so their dependency trees are never pulled in
// ---------------------------------------------------------------------------

vi.mock('../ImportSessionsDialog', () => ({
  ImportSessionsDialog: () => null,
}));

vi.mock('../ArchivedSessionsDialog', () => ({
  ArchivedSessionsDialog: () => null,
}));

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are registered
// ---------------------------------------------------------------------------

const { SessionsMoreMenu } = await import('../SessionsMoreMenu');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    path: `/projects/${name}`,
    createdAt: '2026-01-01T00:00:00Z',
    lastOpenedAt: '2026-01-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Reset per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  __projects = [];
  __filterProjectId = null;
});

describe('SessionsMoreMenu — trigger and menu contents', () => {
  it('renders data-testid="sessions-more-button"', () => {
    render(<SessionsMoreMenu />);
    expect(screen.getByTestId('sessions-more-button')).toBeTruthy();
  });

  it('renders sessions-more-import and sessions-more-archived after clicking the trigger', async () => {
    __projects = [makeProject('p1', 'mainframe')];
    render(<SessionsMoreMenu />);

    await userEvent.click(screen.getByTestId('sessions-more-button'));

    expect(screen.getByTestId('sessions-more-import')).toBeTruthy();
    expect(screen.getByTestId('sessions-more-archived')).toBeTruthy();
  });
});

describe('SessionsMoreMenu — menu item enable state follows project availability', () => {
  it.each<{ name: string; projects: Project[]; testId: string; expectDisabled: boolean }>([
    {
      name: 'import is disabled when there are no projects',
      projects: [],
      testId: 'sessions-more-import',
      expectDisabled: true,
    },
    {
      name: 'import is enabled when at least one project exists',
      projects: [makeProject('p1', 'mainframe')],
      testId: 'sessions-more-import',
      expectDisabled: false,
    },
    {
      name: 'archived is never disabled, even when projects is empty',
      projects: [],
      testId: 'sessions-more-archived',
      expectDisabled: false,
    },
  ])('$name', async ({ projects, testId, expectDisabled }) => {
    __projects = projects;
    render(<SessionsMoreMenu />);

    await userEvent.click(screen.getByTestId('sessions-more-button'));

    const item = screen.getByTestId(testId);
    // Radix DropdownMenuItem sets aria-disabled="true" when disabled={true}
    if (expectDisabled) {
      expect(item.getAttribute('aria-disabled')).toBe('true');
    } else {
      expect(item.getAttribute('aria-disabled')).not.toBe('true');
    }
  });
});
