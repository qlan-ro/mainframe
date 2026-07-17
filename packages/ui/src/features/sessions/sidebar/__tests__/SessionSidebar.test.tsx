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
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionCustom, SessionItem } from '../../view-model/chat-to-thread-custom';
import type { Project, SyntheticTag } from '@qlan-ro/mainframe-types';
import { getDraftConfig, setDraftConfig, useDraftConfigStore } from '../../runtime/draft-config';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
import { useDraftReturnTarget } from '../../new-thread/use-draft-return-target';
import { useUiPrefs } from '@/store/ui-prefs';

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
// Shared across the module-scope useAssistantRuntime() mock so component code and
// assertions see the SAME spy instance — a fresh vi.fn() per call would be
// unobservable from the test.
const switchToThreadSpy = vi.fn();
const switchToNewThreadSpy = vi.fn();

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
      switchToThread: switchToThreadSpy,
      switchToNewThread: switchToNewThreadSpy,
    },
  }),
  // SessionSidebar now subscribes reactively via useAuiState((s) => s.threads.threadItems)
  // instead of an imperative getState() read. The store-scope threadItems array is the
  // ordered ThreadListEntry[] the projection consumes. newThreadId is exposed the same
  // way for the reactive draft-row model (useDraftRow).
  useAuiState: (
    selector: (s: { threads: { threadItems: unknown; mainThreadId: string; newThreadId: string | null } }) => unknown,
  ) => selector({ threads: { threadItems: __threads, mainThreadId: '', newThreadId: __newThreadId } }),
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
    projects,
    filterProjectId: _fid,
    onSelect,
  }: {
    projects: Project[];
    filterProjectId: string | null;
    attentionCounts: Record<string, number>;
    onSelect: (id: string | null) => void;
  }) => (
    <div data-testid="sessions-filter-pill-all" aria-pressed={_fid == null ? 'true' : 'false'}>
      {projects.map((p) => (
        <button key={p.id} data-testid={`sessions-filter-pill-${p.id}`} type="button" onClick={() => onSelect(p.id)} />
      ))}
    </div>
  ),
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

// Stub TasksSidebarSection — reads useActiveIdentity/useDaemonPort/useTodosStore,
// none of which this file sets up; a sentinel div is enough to assert ordering.
vi.mock('@/features/tasks/TasksSidebarSection', () => ({
  TasksSidebarSection: () => <div data-testid="tasks-sidebar-section-stub" />,
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
    transcriptMissing: false,
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
  switchToThreadSpy.mockReset();
  switchToNewThreadSpy.mockReset();
  useDraftConfigStore.setState({ drafts: new Map() });
  useNewThreadReady.setState({ readyIds: new Set() });
  useDraftReturnTarget.setState({ returnThreadId: null });
  useUiPrefs.setState({ collapsedSidebarSections: {} });
});

// ---------------------------------------------------------------------------
// 1. sessions-list-scroll is in the DOM (outer glass wrapper moved to SidebarShell)
// ---------------------------------------------------------------------------

describe('SessionSidebar — list scroll area is present on render', () => {
  it('renders data-testid="sessions-list-scroll"', () => {
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-list-scroll')).toBeTruthy();
  });

  it('keeps the scrollbar gutter transparent so the parent background shows through', () => {
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-list-scroll').className).toContain('bg-transparent');
  });
});

it('renders data-testid="sessions-new-button"', () => {
  render(<SessionSidebar />);
  expect(screen.getByTestId('sessions-new-button')).toBeTruthy();
});

// ---------------------------------------------------------------------------
// 2a. The "Sessions" group header IS collapsible — supersedes the old finding
// 1.9 no-chevron artboard-parity assertion. All four root sections (Projects/
// Sessions/Tasks/Tags) got a disclosure chevron so the whole sidebar is
// collapsible, section by section, backed by useUiPrefs.collapsedSidebarSections.
// ---------------------------------------------------------------------------

describe('SessionSidebar — Sessions group header is collapsible', () => {
  it('renders a chevron-down icon next to the "Sessions" label', () => {
    render(<SessionSidebar />);
    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(document.querySelector('svg.lucide-chevron-down[aria-hidden="true"]')).toBeTruthy();
  });

  it('clicking the toggle hides the new-session button and session list', () => {
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-new-button')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sessions-section-toggle'));
    expect(screen.queryByTestId('sessions-new-button')).toBeNull();
  });

  it('clicking the toggle again shows the section again', () => {
    render(<SessionSidebar />);
    fireEvent.click(screen.getByTestId('sessions-section-toggle'));
    fireEvent.click(screen.getByTestId('sessions-section-toggle'));
    expect(screen.getByTestId('sessions-new-button')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2b. Clicking the new-button fires the ThreadListPrimitive.New handler.
//     The `Hint` tooltip wrapper must not sit between the asChild Slot and the
//     button, or the injected onClick never reaches the DOM element.
//
//     NOTE (Task 9 wiring): the "+" is now SessionsNewButton (Task 8). In the
//     "All" view (filterProjectId=null) it opens NewSessionPickerPopover instead
//     of firing ThreadListPrimitive.New directly — that primitive only fires from
//     the pill-active branch, so this test activates a project pill to keep
//     exercising the same underlying primitive-composition behavior.
// ---------------------------------------------------------------------------

it('invokes the ThreadListPrimitive.New onClick when sessions-new-button is clicked with a project pill active', async () => {
  __filterProjectId = 'p1';
  render(<SessionSidebar />);
  await userEvent.click(screen.getByTestId('sessions-new-button'));
  expect(newThreadClickSpy).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// 2c. Clicking the new-button resets the reused newThreadId's stale draft.
//     aui reuses the same __LOCALID_* slot until a message is sent, so an
//     abandoned draft (project seeded, never sent) must not leak into the next
//     New — else the chat is created in the stale project / the picker is skipped.
//
//     NOTE (Task 9 wiring): same pill-active branch as 2b above — the reset in
//     the "All" view only runs once a project is picked from the popover
//     (covered by SessionsNewButton's own tests), not on the trigger click alone.
// ---------------------------------------------------------------------------

it('clears the draft-config and ready flag for the current newThreadId on click', async () => {
  __filterProjectId = 'p1';
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

// ---------------------------------------------------------------------------
// 2d. Selecting a project pill activates that project's session, or opens a
//     new-thread draft when the project is empty — so the chat pane never
//     strands the previously-selected session from a different project.
// ---------------------------------------------------------------------------

describe('SessionSidebar — selecting a project pill reconciles the active thread', () => {
  it('switches to the project session when the project has one', async () => {
    __projects = [makeProject('p1', 'Alpha'), makeProject('p2', 'Beta')];
    __threads = [makeThread('t1', { projectId: 'p1' })];
    render(<SessionSidebar />);

    await userEvent.click(screen.getByTestId('sessions-filter-pill-p1'));

    expect(setFilterProjectIdSpy).toHaveBeenCalledWith('p1');
    expect(switchToThreadSpy).toHaveBeenCalledWith('t1');
    expect(switchToNewThreadSpy).not.toHaveBeenCalled();
  });

  it('opens a new-thread draft when the selected project is empty', async () => {
    __projects = [makeProject('p1', 'Alpha'), makeProject('p2', 'Beta')];
    __threads = [makeThread('t1', { projectId: 'p1' })];
    render(<SessionSidebar />);

    // p2 has no sessions — must not leave p1's session active.
    await userEvent.click(screen.getByTestId('sessions-filter-pill-p2'));

    expect(setFilterProjectIdSpy).toHaveBeenCalledWith('p2');
    expect(switchToNewThreadSpy).toHaveBeenCalledTimes(1);
    expect(switchToThreadSpy).not.toHaveBeenCalled();
  });
});

it('renders sessions-empty-state with text "No sessions yet"', () => {
  __threads = [];
  __projects = [];
  render(<SessionSidebar />);
  const emptyState = screen.getByTestId('sessions-empty-state');
  expect(emptyState).toBeTruthy();
  expect(emptyState.textContent).toContain('No sessions yet');
});

// Recent mode buckets by time, NOT project — two threads updated "now" land in Today.
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

// A pinned thread lands in a Pinned group, ahead of time buckets, excluded from them.
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

it('renders exactly 2 elements with data-testid="sessions-row"', () => {
  __filterProjectId = null;
  __projects = [makeProject('p1', 'mainframe')];
  __threads = [makeThread('c1', { projectId: 'p1' }), makeThread('c2', { projectId: 'p1' })];
  render(<SessionSidebar />);
  const rows = screen.getAllByTestId('sessions-row');
  expect(rows).toHaveLength(2);
});

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

it('renders data-testid="sessions-filter-pill-all"', () => {
  render(<SessionSidebar />);
  expect(screen.getByTestId('sessions-filter-pill-all')).toBeTruthy();
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

// ---------------------------------------------------------------------------
// 8. TagFilterBar is mounted (sessions-tag-filter-bar present)
// Per the warm-chrome artboard it is now pinned at the BOTTOM, AFTER the
// scrollable session list — assert it renders AND comes after the list region.
// TasksSidebarSection sits between the two: right after the session list,
// before the tag filter footer.
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

  it('renders the tasks section right after the session list, before the tag filter bar', () => {
    render(<SessionSidebar />);
    const tasks = screen.getByTestId('tasks-sidebar-section-stub');
    const tagBar = screen.getByTestId('sessions-tag-filter-bar');
    expect(tasks.compareDocumentPosition(tagBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 12. Draft row (Task 9 wiring): the synthetic "New Session" row above the time
// groups, gated by draftRowVisible(model, filterProjectId) — visible once a
// draft-config exists for the reactive newThreadId, hidden behind a different
// project's active pill, and discardable back to the pre-draft selection.
// ---------------------------------------------------------------------------

describe('SessionSidebar — draft row', () => {
  it('renders the draft row once a draft-config exists for the new thread', () => {
    __newThreadId = '__LOCALID_draft';
    setDraftConfig('__LOCALID_draft', { projectId: 'proj-a', adapterId: 'claude' });
    render(<SessionSidebar />);
    expect(screen.getByTestId('sessions-draft-row-title')).toHaveTextContent('New Session');
  });

  it('hides the draft row when a different project pill is active', () => {
    __newThreadId = '__LOCALID_draft';
    setDraftConfig('__LOCALID_draft', { projectId: 'proj-a', adapterId: 'claude' });
    __filterProjectId = 'proj-b';
    render(<SessionSidebar />);
    expect(screen.queryByTestId('sessions-draft-row')).toBeNull();
  });

  it('discarding the draft resets it and switches to the return target', () => {
    __newThreadId = '__LOCALID_draft';
    setDraftConfig('__LOCALID_draft', { projectId: 'proj-a', adapterId: 'claude' });
    useDraftReturnTarget.getState().setReturnTarget('chat-prev');
    render(<SessionSidebar />);
    fireEvent.click(screen.getByTestId('sessions-draft-row-discard'));
    expect(switchToThreadSpy).toHaveBeenCalledWith('chat-prev');
    expect(getDraftConfig('__LOCALID_draft')).toBeUndefined();
    expect(screen.queryByTestId('sessions-draft-row')).toBeNull();
  });
});
