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
import { cloneElement, isValidElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionCustom, SessionItem } from '../../view-model/chat-to-thread-custom';
import type { Project, SyntheticTag } from '@qlan-ro/mainframe-types';
import { getDraftConfig, setDraftConfig, useDraftConfigStore } from '../../runtime/draft-config';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';

// ---------------------------------------------------------------------------
// Mutable control state — set per test before rendering
// ---------------------------------------------------------------------------

let __threads: { id: string; remoteId?: string; title?: string; status: string; custom: SessionCustom }[] = [];
let __projects: Project[] = [];
let __filterProjectId: string | null = null;
let __selectedTags: Set<string> = new Set();
const __selectedSynthetic: Set<SyntheticTag> = new Set();
let __sortMode: 'recent' | 'name' | 'status' = 'recent';
let __newThreadId: string | null = null;
const setFilterProjectIdSpy = vi.fn();
const setSortModeSpy = vi.fn();
// Spy injected by the ThreadListPrimitive.New `asChild` Slot — see the mock below.
const newThreadClickSpy = vi.fn();

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAssistantRuntime: () => ({
    threads: {
      getState: () => {
        const threadIds = __threads.map((t) => t.id);
        const threadItems = Object.fromEntries(__threads.map((t) => [t.id, t]));
        return { threadIds, threadItems, mainThreadId: '', newThreadId: __newThreadId };
      },
      getItemById: (_id: string) => ({ rename: vi.fn(), archive: vi.fn() }),
      switchToThread: vi.fn(),
    },
  }),
  // SessionSidebar now subscribes reactively via useAuiState((s) => s.threads.threadItems)
  // instead of an imperative getState() read. The store-scope threadItems array is the
  // ordered ThreadListEntry[] the projection consumes.
  useAuiState: (selector: (s: { threads: { threadItems: unknown; mainThreadId: string } }) => unknown) =>
    selector({ threads: { threadItems: __threads, mainThreadId: '' } }),
  // Faithful `asChild` repro: the real primitive is a Radix Slot that clones its
  // single child and injects onClick onto it — composing the caller's onClick
  // BEFORE its own switchToNewThread (composeEventHandlers), then the switch itself
  // (here newThreadClickSpy). A passthrough `<>{children}</>` would hide the
  // prop-forwarding bug; dropping the caller onClick would hide the draft reset.
  ThreadListPrimitive: {
    New: ({
      children,
      asChild,
      onClick,
    }: {
      children?: React.ReactNode;
      asChild?: boolean;
      onClick?: (e: unknown) => void;
    }) => {
      const composed = (e: unknown) => {
        onClick?.(e);
        newThreadClickSpy(e);
      };
      return asChild && isValidElement(children) ? (
        cloneElement(children as React.ReactElement<Record<string, unknown>>, { onClick: composed })
      ) : (
        <>{children}</>
      );
    },
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
    sortMode: __sortMode,
    setFilterProjectId: setFilterProjectIdSpy,
    setSortMode: setSortModeSpy,
  }),
}));

// ---------------------------------------------------------------------------
// Mock @/store/unread-store
// ---------------------------------------------------------------------------

const __unreadState = {
  unread: new Set<string>(),
  isUnread: (_id: string) => false,
};
vi.mock('@/store/unread-store', () => ({
  useUnreadStore: (selector: (s: typeof __unreadState) => unknown) => selector(__unreadState),
}));

// ---------------------------------------------------------------------------
// Mock SidebarFooter — avoids pulling in ConnectionStatusContext for sidebar tests
// ---------------------------------------------------------------------------

vi.mock('@/layout/SidebarFooter', () => ({
  SidebarFooter: () => <div data-testid="sidebar-footer-stub" />,
}));

// ---------------------------------------------------------------------------
// Stub child components to minimise dependency pull-in
// ---------------------------------------------------------------------------

// SessionSidebar now renders the list through SessionListVirtuoso (react-virtuoso
// windowing) instead of mapping SessionGroup. Virtuoso renders nothing under jsdom
// (no layout), so mock it to a plain synchronous passthrough that renders every
// group header + item — this keeps these tests focused on the sidebar's
// grouping/filter/prop-passing logic, not the windowing engine (covered by
// SessionListVirtuoso's own test).
vi.mock('../SessionListVirtuoso', () => ({
  SessionListVirtuoso: ({
    groups,
    showProject,
    renderItem,
  }: {
    groups: { label: string; items: SessionItem[] }[];
    showProject: boolean;
    renderItem: (i: SessionItem, flags: { inPinnedGroup: boolean; showProject: boolean }) => React.ReactNode;
  }) => (
    <div data-testid="sessions-list-scroll">
      {groups.map((group) => (
        <div key={group.label} data-testid={`sessions-group-${group.label}`}>
          {group.items.map((item) => renderItem(item, { inPinnedGroup: group.label === 'Pinned', showProject }))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../SessionRow', () => ({
  SessionRow: ({ item, projectName }: { item: SessionItem; projectName?: string }) => (
    <div data-testid="sessions-row" data-id={item.id} data-project-name={projectName ?? ''} />
  ),
}));

vi.mock('../SessionSortMenu', () => ({
  SessionSortMenu: ({
    mode,
    onChange,
  }: {
    mode: 'recent' | 'name' | 'status';
    onChange: (m: 'recent' | 'name' | 'status') => void;
  }) => <button data-testid="sessions-sort-button" data-mode={mode} type="button" onClick={() => onChange('name')} />,
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
  __sortMode = 'recent';
  __newThreadId = null;
  setFilterProjectIdSpy.mockReset();
  setSortModeSpy.mockReset();
  newThreadClickSpy.mockReset();
  useDraftConfigStore.setState({ drafts: new Map() });
  useNewThreadReady.setState({ readyIds: new Set() });
});

// ---------------------------------------------------------------------------
// 1. sessions-list-scroll is in the DOM (outer glass wrapper moved to SidebarShell)
// ---------------------------------------------------------------------------

describe('SessionSidebar — list scroll area is present on render', () => {
  it('renders data-testid="sessions-list-scroll"', () => {
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-list-scroll')).toBeTruthy();
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
// 2b. Clicking the new-button fires the ThreadListPrimitive.New handler.
//     The `Hint` tooltip wrapper must not sit between the asChild Slot and the
//     button, or the injected onClick never reaches the DOM element.
// ---------------------------------------------------------------------------

describe('SessionSidebar — new-button triggers the New-thread handler', () => {
  it('invokes the ThreadListPrimitive.New onClick when sessions-new-button is clicked', async () => {
    render(<SessionSidebar />);
    await userEvent.click(screen.getByTestId('sessions-new-button'));
    expect(newThreadClickSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2c. Clicking the new-button resets the reused newThreadId's stale draft.
//     aui reuses the same __LOCALID_* slot until a message is sent, so an
//     abandoned draft (project seeded, never sent) must not leak into the next
//     New — else the chat is created in the stale project / the picker is skipped.
// ---------------------------------------------------------------------------

describe('SessionSidebar — new-button resets a stale reused-slot draft', () => {
  it('clears the draft-config and ready flag for the current newThreadId on click', async () => {
    __newThreadId = '__LOCALID_reuse';
    setDraftConfig('__LOCALID_reuse', { projectId: 'stale-proj', adapterId: 'claude' });
    useNewThreadReady.getState().markReady('__LOCALID_reuse');

    render(<SessionSidebar />);
    await userEvent.click(screen.getByTestId('sessions-new-button'));

    expect(getDraftConfig('__LOCALID_reuse')).toBeUndefined();
    expect(useNewThreadReady.getState().isReady('__LOCALID_reuse')).toBe(false);
    // The switch still fires — the reset composes BEFORE it, not instead of it.
    expect(newThreadClickSpy).toHaveBeenCalledTimes(1);
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
// 4. Time group present + empty state absent — recent mode buckets by time, NOT
//    project. Two threads updated "now" land in the Today group.
// ---------------------------------------------------------------------------

describe('SessionSidebar — time group present and empty state absent when threads exist', () => {
  it('renders sessions-group-Today (NOT a project group) and no empty state for two threads updated now', () => {
    __projects = [makeProject('p1', 'mainframe')];
    __threads = [
      makeThread('c1', { projectId: 'p1', updatedAt: Date.now() }),
      makeThread('c2', { projectId: 'p1', updatedAt: Date.now() }),
    ];
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-group-Today')).toBeTruthy();
    expect(screen.queryByTestId('sessions-group-p1')).toBeNull();
    expect(screen.queryByTestId('sessions-empty-state')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4b. Pinned section: a pinned thread lands in a Pinned group, ahead of time
//     buckets, and is excluded from them.
// ---------------------------------------------------------------------------

describe('SessionSidebar — pinned thread forms a Pinned group', () => {
  it('renders sessions-group-Pinned plus sessions-group-Today for a pinned + an unpinned thread', () => {
    __projects = [makeProject('p1', 'mainframe')];
    __threads = [
      makeThread('pin1', { projectId: 'p1', pinned: true, updatedAt: Date.now() }),
      makeThread('today1', { projectId: 'p1', updatedAt: Date.now() }),
    ];
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-group-Pinned')).toBeTruthy();
    expect(screen.getByTestId('sessions-group-Today')).toBeTruthy();
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
// 9. Sort menu: present in the header and wired to setSortMode.
// ---------------------------------------------------------------------------

describe('SessionSidebar — Sort By menu is wired to setSortMode', () => {
  it('renders the sort button reflecting the active sortMode', () => {
    __sortMode = 'status';
    render(<SessionSidebar />);
    const btn = screen.getByTestId('sessions-sort-button');
    expect(btn.getAttribute('data-mode')).toBe('status');
  });

  it('invokes setSortMode when an option is chosen', async () => {
    render(<SessionSidebar />);
    await userEvent.click(screen.getByTestId('sessions-sort-button'));
    expect(setSortModeSpy).toHaveBeenCalledWith('name');
  });
});

// ---------------------------------------------------------------------------
// 10. Project chip: shown ("All" view) vs hidden (a project filter is active).
// ---------------------------------------------------------------------------

describe('SessionSidebar — per-row project chip follows the filter state', () => {
  it('passes projectName to rows when no project filter is active (showProject)', () => {
    __filterProjectId = null;
    __projects = [makeProject('p1', 'mainframe')];
    __threads = [makeThread('c1', { projectId: 'p1', updatedAt: Date.now() })];
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-row').getAttribute('data-project-name')).toBe('mainframe');
  });

  it('omits projectName from rows when a project filter is active', () => {
    __filterProjectId = 'p1';
    __projects = [makeProject('p1', 'mainframe')];
    __threads = [makeThread('c1', { projectId: 'p1', updatedAt: Date.now() })];
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-row').getAttribute('data-project-name')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 11. Archived sessions are excluded from the visible list (archived-leak fix).
//     The store-scope threadItems array carries BOTH regular and archived
//     threads; SessionSidebar must project through the regular-only seam so an
//     archived entry never renders as a sessions-row.
// ---------------------------------------------------------------------------

describe('SessionSidebar — archived sessions are excluded from the list', () => {
  it('renders exactly 1 sessions-row for one regular + one archived thread', () => {
    __projects = [makeProject('p1', 'mainframe')];
    __threads = [
      makeThread('c1', { projectId: 'p1', updatedAt: Date.now() }),
      { ...makeThread('c2', { projectId: 'p1', updatedAt: Date.now() }), status: 'archived' },
    ];
    render(<SessionSidebar />);
    const rows = screen.getAllByTestId('sessions-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-id')).toBe('c1');
  });
});

// ---------------------------------------------------------------------------
// 8. TagFilterBar is mounted (sessions-tag-filter-bar present)
// Per the warm-chrome artboard it is now pinned at the BOTTOM, AFTER the
// scrollable session list — assert it renders AND comes after the list region.
// ---------------------------------------------------------------------------

describe('SessionSidebar — TagFilterBar is mounted at the bottom, after the list', () => {
  it('renders data-testid="sessions-tag-filter-bar"', () => {
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-tag-filter-bar')).toBeTruthy();
  });

  it('renders the tag filter bar AFTER the project filter pills in DOM order', () => {
    render(<SessionSidebar />);
    const pills = screen.getByTestId('sessions-filter-pill-all');
    const tagBar = screen.getByTestId('sessions-tag-filter-bar');
    // compareDocumentPosition: FOLLOWING (4) means tagBar comes after pills.
    expect(pills.compareDocumentPosition(tagBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
