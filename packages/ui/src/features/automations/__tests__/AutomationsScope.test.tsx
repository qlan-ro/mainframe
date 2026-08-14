/**
 * AutomationsScope.test.tsx
 *
 * Behavior coverage for todo #326's Automations acceptance criteria, driven
 * through the real AutomationsHost + useSessionFilters + useModalProjectScope.
 * AutomationsHost.test.tsx / AutomationsView.test.tsx already cover the
 * per-open scope's wiring in isolation; this file drives it end to end
 * against a stub gateway that actually differentiates projects.
 *
 * Instrument: installs its own stub gateway in beforeEach, delegating to
 * createFixtureGateway() and overriding only listAutomations with fact 1's
 * semantics (project match OR unscoped) over a hand-built A/B/unscoped trio —
 * the shipped fixture gateway filters by strict equality and every shipped
 * fixture is unscoped, so a scoped read through it always comes back empty
 * (plan's Established fact 1, and the risk noted for tasks 15/20). Restores
 * the real fixture gateway in afterEach — the store is module-global.
 *
 * Behaviors covered:
 *  1. Session in A, filter on B: lists B's automations plus the unscoped one,
 *     names B (AC2).
 *  2. The header picker re-scopes and reloads; no A row survives (AC3, AC4).
 *  3. Picking inside the modal never writes the sidebar filter (AC5).
 *  4. An override made in the Kanban board does not leak into a later
 *     Automations open, which still seeds from the sidebar filter (AC6).
 *  5. The picker is inoperable while any sub-view (editor, run, describe,
 *     details) owns the modal, and operable again on return (AC13).
 *  6. A created automation carries the scoped project id (AC10) — the
 *     editor's skills/files/branch pickers reading the same
 *     `store.scopeProjectId` field are covered by their own suites (facts 7,
 *     8); this test pins that the field itself holds the open modal's scope.
 *  7. The sidebar's pending badge is populated on mount with the modal never
 *     opened, and is unaffected by a later scope change (AC14).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationCreateInput, AutomationSummary } from '../contract';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AutomationsHost } from '../AutomationsHost';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { createFixtureGateway } from '../fixtures/fixture-gateway';
import { useSessionFilters } from '@/store/session-filters';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { TasksModalHost } from '@/features/tasks/TasksModalHost';
import { useTasksModal } from '@/features/tasks/use-tasks-modal';
import { useTodosStore } from '@/features/tasks/use-todos-store';
import * as todosApi from '@/lib/api/todos';

// The scope hook's second seed source; most tests set an explicit filter, so
// this only needs to answer with a stable shape.
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: vi.fn(() => ({ projectId: undefined })),
}));

vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({
    projects: [
      { id: 'proj-1', name: 'Mainframe' },
      { id: 'proj-2', name: 'Sidecar' },
    ],
  }),
}));

// AC6 mounts TasksModalHost alongside AutomationsHost — its own todos client
// and session-spawn hook, out of scope for every other case in this file.
vi.mock('@/lib/api/todos', () => ({
  listTodos: vi.fn(async () => []),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  moveTodo: vi.fn(),
  deleteTodo: vi.fn(),
  uploadAttachment: vi.fn(),
}));
vi.mock('@/features/tasks/use-start-todo-session', () => ({
  useStartTodoSession: () => vi.fn(),
}));

function definition(id: string, name: string, projectId: string | null): AutomationSummary {
  return {
    id,
    name,
    scope: projectId ? 'project' : 'global',
    projectId,
    enabled: true,
    definition: { triggers: [], steps: [] },
    createdAt: 1,
    updatedAt: 1,
  };
}

const A_DEF = definition('auto-a', 'A only', 'proj-1');
const B_DEF = definition('auto-b', 'B only', 'proj-2');
const UNSCOPED_DEF = definition('auto-u', 'Unscoped', null);

/** Fact 1's semantics over a hand-built set — the shipped fixture gateway
 *  filters by strict equality and every shipped fixture is unscoped, so it
 *  can never exercise a scoped read (plan's Established fact 1). */
function stubGateway(onCreate?: (input: AutomationCreateInput) => void) {
  const base = createFixtureGateway();
  const all = [A_DEF, B_DEF, UNSCOPED_DEF];
  return {
    ...base,
    listAutomations: async (projectId?: string | null) =>
      projectId ? all.filter((d) => d.projectId === projectId || d.projectId === null) : all,
    createAutomation: async (input: AutomationCreateInput) => {
      onCreate?.(input);
      return base.createAutomation(input);
    },
  };
}

function renderHost() {
  return render(
    <TooltipProvider>
      <AutomationsHost />
    </TooltipProvider>,
  );
}

async function openPicker(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger);
}

beforeEach(() => {
  vi.mocked(useActiveIdentity).mockReturnValue({ projectId: undefined } as ReturnType<typeof useActiveIdentity>);
  useSessionFilters.setState({ filterProjectId: null });
  useAutomationsNav.setState({
    open: false,
    editorTarget: null,
    runId: null,
    describeOpen: false,
    detailsAutomationId: null,
  });
  useAutomationsStore.setState({ scopeProjectId: null, definitions: [], interactions: [], gateway: stubGateway() });
  useTasksModal.setState({ open: false, quickOpen: false });
  useTodosStore.setState({ entries: {} });
  vi.mocked(todosApi.listTodos).mockClear();
});

afterEach(() => {
  useAutomationsStore.setState({ gateway: createFixtureGateway() });
});

// ---------------------------------------------------------------------------
// 1. AC2 — session in A, filter on B
// ---------------------------------------------------------------------------

describe('AutomationsHost — session in A, filter on B', () => {
  it('lists B’s automations plus the unscoped one, and names B', async () => {
    vi.mocked(useActiveIdentity).mockReturnValue({ projectId: 'proj-1' } as ReturnType<typeof useActiveIdentity>);
    useSessionFilters.setState({ filterProjectId: 'proj-2' });
    useAutomationsNav.setState({ open: true });

    renderHost();

    expect(await screen.findByTestId('automations-library-row-auto-b')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-row-auto-u')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-library-row-auto-a')).toBeNull();
    expect(screen.getByTestId('automations-project-picker')).toHaveTextContent('Sidecar');
  });
});

// ---------------------------------------------------------------------------
// 2-3. AC3/AC4/AC5 — the header picker re-scopes, never writes the filter
// ---------------------------------------------------------------------------

describe('AutomationsHost — the header picker', () => {
  it('re-scopes the library, drops the previous project’s rows, and leaves the sidebar filter untouched', async () => {
    const user = userEvent.setup();
    useSessionFilters.setState({ filterProjectId: 'proj-2' });
    useAutomationsNav.setState({ open: true });

    renderHost();
    expect(await screen.findByTestId('automations-library-row-auto-b')).toBeInTheDocument();

    await openPicker('automations-project-picker');
    await user.click(await screen.findByTestId('automations-project-proj-1'));

    expect(await screen.findByTestId('automations-library-row-auto-a')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-library-row-auto-b')).toBeNull();
    expect(screen.getByTestId('automations-library-row-auto-u')).toBeInTheDocument();
    expect(screen.getByTestId('automations-project-picker')).toHaveTextContent('Mainframe');

    // AC5 — the sidebar filter never moves.
    expect(useSessionFilters.getState().filterProjectId).toBe('proj-2');
  });
});

// ---------------------------------------------------------------------------
// 4. AC6 — a Kanban override does not leak into a later Automations open
// ---------------------------------------------------------------------------

describe('AutomationsHost — after an override made in the Kanban modal', () => {
  it('still opens on the sidebar filter’s project, not the board’s override', async () => {
    const user = userEvent.setup();
    useSessionFilters.setState({ filterProjectId: 'proj-2' });

    render(
      <TooltipProvider>
        <TasksModalHost port={31415} />
        <AutomationsHost />
      </TooltipProvider>,
    );

    act(() => useTasksModal.getState().openModal());
    await waitFor(() => expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Sidecar'));

    await openPicker('tasks-board-project-picker');
    await user.click(await screen.findByTestId('tasks-board-project-proj-1'));
    await waitFor(() => expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Mainframe'));

    act(() => useAutomationsNav.setState({ open: true }));

    expect(await screen.findByTestId('automations-library-row-auto-b')).toBeInTheDocument();
    expect(screen.getByTestId('automations-project-picker')).toHaveTextContent('Sidecar');
  });
});

// ---------------------------------------------------------------------------
// 5. AC13 — the picker is inoperable while a sub-view owns the modal
// ---------------------------------------------------------------------------

describe('AutomationsHost — a sub-view is open', () => {
  it('disables the picker, then re-enables it on return to the library', async () => {
    useSessionFilters.setState({ filterProjectId: 'proj-2' });
    useAutomationsNav.setState({ open: true });

    renderHost();
    expect(await screen.findByTestId('automations-library-row-auto-b')).toBeInTheDocument();

    act(() => useAutomationsNav.getState().openEditor({ mode: 'new' }));
    expect(await screen.findByTestId('automations-section-editor')).toBeInTheDocument();
    expect(screen.getByTestId('automations-project-picker')).toBeDisabled();

    act(() => useAutomationsNav.getState().closeEditor());
    await screen.findByTestId('automations-section-library');
    expect(screen.getByTestId('automations-project-picker')).not.toBeDisabled();
  });

  it.each([
    ['a run', { runId: 'r1' }],
    ['describe', { describeOpen: true }],
    ['details', { detailsAutomationId: 'auto-b' }],
  ])('stays disabled while %s owns the modal', async (_label, nav) => {
    useSessionFilters.setState({ filterProjectId: 'proj-2' });
    useAutomationsNav.setState({ open: true });

    renderHost();
    await screen.findByTestId('automations-library-row-auto-b');

    act(() => useAutomationsNav.setState(nav));

    expect(screen.getByTestId('automations-project-picker')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 6. AC10 — a created automation carries the scoped project id
// ---------------------------------------------------------------------------

describe('AutomationsHost — creating an automation', () => {
  it('saves it to the scoped project', async () => {
    const user = userEvent.setup();
    const created: AutomationCreateInput[] = [];
    useAutomationsStore.setState({ gateway: stubGateway((input) => created.push(input)) });
    useSessionFilters.setState({ filterProjectId: 'proj-2' });
    useAutomationsNav.setState({ open: true });

    renderHost();
    expect(await screen.findByTestId('automations-library-row-auto-b')).toBeInTheDocument();
    // The editor reads the scope this host already synced into the store —
    // the seam the skills/files/branch pickers (facts 7, 8) read too.
    expect(useAutomationsStore.getState().scopeProjectId).toBe('proj-2');

    await user.click(screen.getByTestId('automations-library-new'));
    expect(await screen.findByTestId('automations-section-editor')).toBeInTheDocument();

    await user.type(screen.getByTestId('automations-editor-name'), 'New automation');
    await user.click(screen.getByTestId('automations-recipe-root-add'));
    await user.click(screen.getByTestId('automations-recipe-root-add-verb-notify'));
    await user.click(screen.getByTestId('automations-editor-save'));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ scope: 'project', projectId: 'proj-2' });
  });
});

// ---------------------------------------------------------------------------
// 7. AC14 — the pending badge is global, unaffected by an in-modal scope
// ---------------------------------------------------------------------------

describe('AutomationsHost — the sidebar’s pending badge', () => {
  it('is populated on mount with the modal never opened, and unchanged by a scope change', async () => {
    useAutomationsNav.setState({ open: false });

    renderHost();

    await waitFor(() => expect(useAutomationsStore.getState().interactions.length).toBeGreaterThan(0));
    const countAtBoot = useAutomationsStore.getState().interactions.length;

    act(() => {
      useSessionFilters.setState({ filterProjectId: 'proj-2' });
      useAutomationsNav.setState({ open: true });
    });
    await screen.findByTestId('automations-library-row-auto-b');

    expect(useAutomationsStore.getState().interactions.length).toBe(countAtBoot);
  });
});
