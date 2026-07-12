/**
 * ArchivedSessionsDialog — behavior tests.
 *
 * Behaviors covered:
 *  1. Dialog lists only archived rows (data-testid="archived-session-item") from
 *     a mixed thread list; non-archived threads are omitted.
 *  2. Clicking restore-session-btn calls unarchiveChat(port, id) then
 *     runtime.threads.reload().
 *  3. Shows "No archived sessions" empty state when no threads are archived.
 *
 * Strategy:
 *  - Mock @assistant-ui/react: useAssistantRuntime() returns a fake runtime
 *    whose threads.getState() yields the controlled ThreadListRecordState.
 *    threads.reload is a spy.
 *  - Mock @/lib/api/chats so unarchiveChat is a controllable spy.
 *  - Render the dialog with open=true and a project list; inject threads via the
 *    mutable __threads control.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@qlan-ro/mainframe-types';
import type { SessionCustom } from '../../view-model/chat-to-thread-custom';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Mutable control state
// ---------------------------------------------------------------------------

interface ThreadEntry {
  id: string;
  remoteId: string;
  title: string;
  status: string;
  custom: SessionCustom;
}

let __threads: ThreadEntry[] = [];

// ---------------------------------------------------------------------------
// Spies
// ---------------------------------------------------------------------------

const reloadSpy = vi.fn();
const unarchiveChatSpy = vi.fn();

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAssistantRuntime: () => ({
    threads: {
      getState: () => {
        // Mirror the real assistant-ui split: regular threads in threadIds,
        // archived threads in archivedThreadIds (separate bucket).
        const threadIds = __threads.filter((t) => t.status !== 'archived').map((t) => t.id);
        const archivedThreadIds = __threads.filter((t) => t.status === 'archived').map((t) => t.id);
        const threadItems = Object.fromEntries(__threads.map((t) => [t.id, t]));
        return { threadIds, archivedThreadIds, threadItems };
      },
      reload: reloadSpy,
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/api/chats
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/chats', () => ({
  unarchiveChat: (...args: unknown[]) => unarchiveChatSpy(...args),
}));

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are registered
// ---------------------------------------------------------------------------

const { ArchivedSessionsDialog } = await import('../ArchivedSessionsDialog');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORT = 31415;

function makeCustom(projectId: string, updatedAt: number, status: 'active' | 'archived' = 'active'): SessionCustom {
  return {
    projectId,
    adapterId: 'claude',
    tags: [],
    pinned: false,
    status,
    displayStatus: 'idle',
    hasPending: false,
    detectedPrs: [],
    worktreeMissing: false,
    transcriptMissing: false,
    updatedAt,
  };
}

function makeThread(
  id: string,
  archivedStatus: 'regular' | 'archived',
  projectId = 'proj-1',
  updatedAt = 1_000_000,
): ThreadEntry {
  return {
    id,
    remoteId: id,
    title: `Session ${id}`,
    status: archivedStatus,
    custom: makeCustom(projectId, updatedAt, archivedStatus === 'archived' ? 'archived' : 'active'),
  };
}

const PROJECTS: Project[] = [
  {
    id: 'proj-1',
    name: 'mainframe',
    path: '/projects/mainframe',
    createdAt: '2026-01-01T00:00:00Z',
    lastOpenedAt: '2026-01-01T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Reset per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  __threads = [];
  reloadSpy.mockReset();
  reloadSpy.mockResolvedValue(undefined);
  unarchiveChatSpy.mockReset();
  unarchiveChatSpy.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderDialog(filterProjectId: string | null = null) {
  render(
    <TooltipProvider>
      <ArchivedSessionsDialog
        open={true}
        onOpenChange={vi.fn()}
        port={PORT}
        projects={PROJECTS}
        filterProjectId={filterProjectId}
      />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// 1. Only archived rows render
// ---------------------------------------------------------------------------

describe('ArchivedSessionsDialog — lists only archived rows', () => {
  it('renders one archived-session-item for the single archived thread in a mixed list', () => {
    __threads = [
      makeThread('active-1', 'regular'),
      makeThread('archived-1', 'archived'),
      makeThread('active-2', 'regular'),
    ];

    renderDialog();

    const items = screen.getAllByTestId('archived-session-item');
    expect(items).toHaveLength(1);
  });

  it('renders two archived-session-item elements when two threads are archived', () => {
    __threads = [
      makeThread('archived-a', 'archived', 'proj-1', 200),
      makeThread('archived-b', 'archived', 'proj-1', 100),
      makeThread('active-x', 'regular'),
    ];

    renderDialog();

    const items = screen.getAllByTestId('archived-session-item');
    expect(items).toHaveLength(2);
  });

  it('does not render archived-session-item when all threads are regular', () => {
    __threads = [makeThread('active-1', 'regular'), makeThread('active-2', 'regular')];

    renderDialog();

    expect(screen.queryByTestId('archived-session-item')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Clicking restore calls unarchiveChat then runtime.threads.reload
// ---------------------------------------------------------------------------

describe('ArchivedSessionsDialog — restore button calls unarchiveChat then reload', () => {
  it('calls unarchiveChat(31415, "archived-1") then reload when restore is clicked', async () => {
    __threads = [makeThread('archived-1', 'archived')];

    renderDialog();

    const restoreBtn = screen.getByTestId('restore-session-btn');
    await act(async () => {
      await userEvent.click(restoreBtn);
    });

    expect(unarchiveChatSpy).toHaveBeenCalledTimes(1);
    expect(unarchiveChatSpy).toHaveBeenCalledWith(31415, 'archived-1');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('calls reload after unarchiveChat resolves (ordering: unarchive first)', async () => {
    __threads = [makeThread('archived-2', 'archived')];
    const callOrder: string[] = [];
    unarchiveChatSpy.mockImplementation(async () => {
      callOrder.push('unarchive');
    });
    reloadSpy.mockImplementation(async () => {
      callOrder.push('reload');
    });

    renderDialog();

    await act(async () => {
      await userEvent.click(screen.getByTestId('restore-session-btn'));
    });

    expect(callOrder).toEqual(['unarchive', 'reload']);
  });
});

// ---------------------------------------------------------------------------
// 3. Empty state
// ---------------------------------------------------------------------------

describe('ArchivedSessionsDialog — empty state when no archived sessions', () => {
  it('shows "No archived sessions" text when all threads are regular', () => {
    __threads = [makeThread('active-1', 'regular')];

    renderDialog();

    expect(screen.getByText('No archived sessions')).toBeTruthy();
  });

  it('shows "No archived sessions" when the thread list is empty', () => {
    __threads = [];

    renderDialog();

    expect(screen.getByText('No archived sessions')).toBeTruthy();
  });
});
