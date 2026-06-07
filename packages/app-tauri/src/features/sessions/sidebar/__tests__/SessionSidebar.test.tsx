/**
 * SessionSidebar — behavior tests (TDD red phase).
 *
 * Strategy:
 *  - Mock @assistant-ui/react: useAssistantRuntime().threads returns a controlled
 *    thread list whose getState() yields the REAL ThreadListState shape
 *    (threadIds + threadItems), exercising the canonical threadListStateToSessionItems path;
 *    ThreadListPrimitive.New renders as a passthrough div.
 *  - Mock ../use-projects so projects are controlled per test.
 *  - Mock @/store/session-filters so filterProjectId / selectedTags are controlled.
 *  - Mock @/store/unread-store so isUnread always returns false.
 *  - Stub child components (SessionGroup, SessionRow, ProjectFilterPillBar,
 *    ArchiveWorktreeDialog) to passthrough/null stubs so tests don't pull in their
 *    full dependency trees.
 *
 * Behaviors covered:
 *  1. data-testid="sessions-sidebar" is in the DOM on render.
 *  2. data-testid="sessions-new-button" is present.
 *  3. Zero threads + zero projects → "sessions-empty-state" visible with text
 *     "No sessions yet".
 *  4. One project (p1) + two threads both in projectId="p1" → "sessions-group-p1"
 *     present; "sessions-empty-state" absent.
 *  5. filterProjectId=null + two threads → exactly 2 "sessions-row" elements render.
 *  6. selectedTags has 'bugfix'; only one of two threads carries tags=['bugfix'] →
 *     exactly 1 "sessions-row" renders.
 *  7. data-testid="sessions-filter-pill-all" is present (ProjectFilterPillBar rendered).
 */
import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SessionCustom, SessionItem } from '../../view-model/chat-to-thread-custom';
import type { Project, SyntheticTag } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Mutable control state — set per test before rendering
// ---------------------------------------------------------------------------

let __threads: { id: string; remoteId?: string; title?: string; status: string; custom: SessionCustom }[] = [];
let __projects: Project[] = [];
let __filterProjectId: string | null = null;
let __selectedTags: Set<string> = new Set();
const __selectedSynthetic: Set<SyntheticTag> = new Set();
const setFilterProjectIdSpy = vi.fn();

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAssistantRuntime: () => ({
    threads: {
      getState: () => {
        const threadIds = __threads.map((t) => t.id);
        const threadItems = Object.fromEntries(__threads.map((t) => [t.id, t]));
        return { threadIds, threadItems, mainThreadId: '' };
      },
      getItemById: (_id: string) => ({ rename: vi.fn(), archive: vi.fn() }),
    },
  }),
  ThreadListPrimitive: {
    New: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  },
}));

// ---------------------------------------------------------------------------
// Mock ../../use-projects (SessionSidebar imports '../use-projects')
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
    selectedTags: __selectedTags,
    selectedSynthetic: __selectedSynthetic,
    setFilterProjectId: setFilterProjectIdSpy,
  }),
}));

// ---------------------------------------------------------------------------
// Mock @/store/unread-store
// ---------------------------------------------------------------------------

vi.mock('@/store/unread-store', () => ({
  useUnreadStore: (selector: (s: { isUnread: (id: string) => boolean }) => unknown) =>
    selector({ isUnread: (_id: string) => false }),
}));

// ---------------------------------------------------------------------------
// Stub child components to minimise dependency pull-in
// ---------------------------------------------------------------------------

vi.mock('../SessionGroup', () => ({
  SessionGroup: ({
    group,
  }: {
    group: { projectId: string; items: SessionItem[] };
    renderItem: (i: SessionItem) => React.ReactNode;
  }) => (
    <div data-testid={`sessions-group-${group.projectId}`}>
      {group.items.map((item) => (
        <div key={item.id} data-testid="sessions-row" />
      ))}
    </div>
  ),
}));

vi.mock('../SessionRow', () => ({
  SessionRow: ({ item }: { item: SessionItem }) => <div data-testid="sessions-row" data-id={item.id} />,
}));

vi.mock('../ProjectFilterPillBar', () => ({
  ProjectFilterPillBar: ({
    filterProjectId: _fid,
    onSelect: _onSelect,
  }: {
    projects: Project[];
    filterProjectId: string | null;
    attentionCounts: Record<string, number>;
    onSelect: (id: string | null) => void;
  }) => <div data-testid="sessions-filter-pill-all" aria-pressed={_fid == null ? 'true' : 'false'} />,
}));

vi.mock('../ArchiveWorktreeDialog', () => ({
  ArchiveWorktreeDialog: () => null,
}));

// ---------------------------------------------------------------------------
// Stub TagFilterBar — renders a sentinel div so test 8 can assert its presence
// ---------------------------------------------------------------------------

vi.mock('../../filter/TagFilterBar', () => ({
  TagFilterBar: () => <div data-testid="sessions-tag-filter-bar" />,
}));

// ---------------------------------------------------------------------------
// Stub daemon-port-context + use-tag-registry so the sidebar can call them
// ---------------------------------------------------------------------------

vi.mock('../../runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('../../tags/use-tag-registry', () => ({
  useTagRegistry: () => ({
    tags: [],
    loading: false,
    refresh: async () => undefined,
    create: async () => undefined,
    update: async () => undefined,
    remove: async () => undefined,
    colorOf: () => 'blue',
  }),
}));

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are registered
// ---------------------------------------------------------------------------

const { SessionSidebar } = await import('../SessionSidebar');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCustom(overrides?: Partial<SessionCustom>): SessionCustom {
  return {
    projectId: 'p1',
    adapterId: 'claude',
    tags: [],
    pinned: false,
    status: 'active',
    displayStatus: 'idle',
    hasPending: false,
    detectedPrs: [],
    worktreeMissing: false,
    updatedAt: 1749284160000,
    ...overrides,
  };
}

function makeThread(
  id: string,
  overrides?: Partial<SessionCustom>,
): { id: string; remoteId: string; title: string; status: string; custom: SessionCustom } {
  return { id, remoteId: id, title: `Session ${id}`, status: 'regular', custom: makeCustom(overrides) };
}

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    path: `/projects/${name}`,
    createdAt: '2024-01-01T00:00:00Z',
    lastOpenedAt: '2024-01-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Reset per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  __threads = [];
  __projects = [];
  __filterProjectId = null;
  __selectedTags = new Set();
  setFilterProjectIdSpy.mockReset();
});

// ---------------------------------------------------------------------------
// 1. sessions-sidebar wrapper is in the DOM
// ---------------------------------------------------------------------------

describe('SessionSidebar — root wrapper is present on render', () => {
  it('renders data-testid="sessions-sidebar"', () => {
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-sidebar')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. sessions-new-button is present
// ---------------------------------------------------------------------------

describe('SessionSidebar — new-button is present', () => {
  it('renders data-testid="sessions-new-button"', () => {
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-new-button')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Empty state: zero threads + zero projects → "No sessions yet"
// ---------------------------------------------------------------------------

describe('SessionSidebar — empty state when no threads and no projects', () => {
  it('renders sessions-empty-state with text "No sessions yet"', () => {
    __threads = [];
    __projects = [];
    render(<SessionSidebar />);
    const emptyState = screen.getByTestId('sessions-empty-state');
    expect(emptyState).toBeTruthy();
    expect(emptyState.textContent).toContain('No sessions yet');
  });
});

// ---------------------------------------------------------------------------
// 4. Group present + empty state absent when one project with two threads
// ---------------------------------------------------------------------------

describe('SessionSidebar — group present and empty state absent when project has threads', () => {
  it('renders sessions-group-p1 and no empty state when two threads belong to p1', () => {
    __projects = [makeProject('p1', 'mainframe')];
    __threads = [makeThread('c1', { projectId: 'p1' }), makeThread('c2', { projectId: 'p1' })];
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-group-p1')).toBeTruthy();
    expect(screen.queryByTestId('sessions-empty-state')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. filterProjectId=null + two threads → exactly 2 sessions-row elements
// ---------------------------------------------------------------------------

describe('SessionSidebar — two sessions-row when filterProjectId=null and two threads', () => {
  it('renders exactly 2 elements with data-testid="sessions-row"', () => {
    __filterProjectId = null;
    __projects = [makeProject('p1', 'mainframe')];
    __threads = [makeThread('c1', { projectId: 'p1' }), makeThread('c2', { projectId: 'p1' })];
    render(<SessionSidebar />);
    const rows = screen.getAllByTestId('sessions-row');
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Tag filter: selectedTags={'bugfix'} + only one thread with that tag → 1 row
// ---------------------------------------------------------------------------

describe('SessionSidebar — tag filter: only matching thread renders', () => {
  it('renders exactly 1 sessions-row when selectedTags={"bugfix"} and only one thread has "bugfix"', () => {
    __selectedTags = new Set(['bugfix']);
    __projects = [makeProject('p1', 'mainframe')];
    __threads = [
      makeThread('c1', { projectId: 'p1', tags: ['bugfix'] }),
      makeThread('c2', { projectId: 'p1', tags: [] }),
    ];
    render(<SessionSidebar />);
    const rows = screen.getAllByTestId('sessions-row');
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 7. ProjectFilterPillBar is rendered (sessions-filter-pill-all present)
// ---------------------------------------------------------------------------

describe('SessionSidebar — ProjectFilterPillBar is rendered', () => {
  it('renders data-testid="sessions-filter-pill-all"', () => {
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-filter-pill-all')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 8. TagFilterBar is mounted (sessions-tag-filter-bar present)
// ---------------------------------------------------------------------------

describe('SessionSidebar — TagFilterBar is mounted below ProjectFilterPillBar', () => {
  it('renders data-testid="sessions-tag-filter-bar"', () => {
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-tag-filter-bar')).toBeTruthy();
  });
});
