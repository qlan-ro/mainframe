/**
 * A new session's empty state (K11): what it says about the project and where
 * the session will run, what it offers, and that it follows the pickers, over
 * the real stores. Only the daemon, aui and the composer's focus are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Todo } from '@/lib/api/todos';

const api = vi.hoisted(() => ({ listTodos: vi.fn(), getGitBranch: vi.fn() }));
vi.mock('@/lib/api/todos', () => ({ listTodos: api.listTodos }));
vi.mock('@/lib/api/git', () => ({ getGitBranch: api.getGitBranch }));
vi.mock('../../runtime/daemon-port-context', () => ({ useDaemonPort: () => 1 }));
const projects = vi.hoisted(() => ({ list: [] as { id: string; name: string }[] }));
vi.mock('../../use-projects', () => ({ useProjects: () => ({ projects: projects.list }) }));
const focus = vi.hoisted(() => vi.fn());
vi.mock('@/features/chat/composer/focus-composer', () => ({ focusVisibleComposer: focus }));

const aui = vi.hoisted(() => ({
  text: '',
  threads: { threadItems: [] as unknown[], isLoading: false },
  switchToThread: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: unknown) => unknown) =>
    sel({ threadListItem: { id: 'local-1' }, threads: aui.threads, thread: { messages: [] } }),
  useAui: () => ({
    threads: { switchToThread: aui.switchToThread, reload: aui.reload },
    composer: {
      getState: () => ({ text: 'stale' }),
      __internal_getRuntime: () => ({ getState: () => ({ text: aui.text }) }),
      setText: (text: string) => {
        aui.text = text;
      },
    },
  }),
}));

import { useProjectBranches } from '@/features/chat/composer/strips/project-branches';
import { useTodosStore } from '@/features/tasks/use-todos-store';
import { patchDraftConfig, setDraftConfig, useDraftConfigStore, type DraftCfg } from '../../runtime/draft-config';
import { useSessionListLoadState } from '../../runtime/list-load-state';
import { NewSessionState } from '../NewSessionState';

const DAY = 86_400_000;
const session = (id: string, over: Record<string, unknown> = {}, custom: Record<string, unknown> = {}) => ({
  id,
  remoteId: id,
  title: `Session ${id}`,
  status: 'regular',
  ...over,
  custom: {
    projectId: 'p1',
    updatedAt: Date.now() - DAY,
    displayStatus: 'idle',
    hasPending: false,
    noProject: false,
    ...custom,
  },
});
const todo = (number: number, over: Partial<Todo> = {}): Todo =>
  ({ id: `t${number}`, number, title: `Task ${number}`, status: 'open', created_at: '', ...over }) as Todo;

const draft = (over: Partial<DraftCfg> = {}) =>
  setDraftConfig('local-1', { projectId: 'p1', adapterId: 'claude', ...over });
const setProject = (projectId: string | null) => act(() => draft({ projectId }));
const where = () => screen.getByTestId('sessions-welcome-where');
const rows = (group: string) =>
  within(screen.getByTestId(group))
    .getAllByRole('button')
    .map((row) => row.textContent);
const flush = () => act(async () => {});

async function show() {
  const view = render(<NewSessionState />);
  await flush();
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  aui.text = '';
  aui.threads = { threadItems: [], isLoading: false };
  projects.list = [
    { id: 'p1', name: 'mainframe' },
    { id: 'p2', name: 'contabil' },
  ];
  api.listTodos.mockResolvedValue([]);
  api.getGitBranch.mockResolvedValue({ branch: 'main' });
  useDraftConfigStore.setState({ drafts: new Map() });
  useTodosStore.setState({ entries: {} });
  useProjectBranches.setState({ byProject: {} });
  useSessionListLoadState.setState({ loaded: true, failed: false });
});

describe('the project and where the session will run', () => {
  it('asks what is next for the project, on its checkout’s branch', async () => {
    draft();
    await show();
    expect(screen.getByRole('heading')).toHaveTextContent('What’s next for mainframe?');
    expect(screen.getByTestId('sessions-welcome-tile')).toHaveTextContent('M');
    expect(where()).toHaveTextContent('Local checkout on main');
  });

  it.each([
    ['a new worktree', { pendingWorktree: { baseBranch: 'main', branchName: 'x' } }, 'New worktree from main'],
    ['a worktree', { worktreePath: '/r/wt', branchName: 'feat/x' }, 'Worktree feat/x'],
    ['a detached worktree', { worktreePath: '/r/loose', branchName: 'detached' }, 'Worktree loose'],
    ['a temporary session', { temporary: true }, 'Temporary session, deleted when closed'],
  ])('follows the branch picker to %s', async (_case, patch, text) => {
    draft();
    await show();
    act(() => patchDraftConfig('local-1', patch));
    expect(where().textContent).toBe(text);
  });

  it('follows a checkout', async () => {
    draft();
    await show();
    act(() => useProjectBranches.setState({ byProject: { p1: 'feat/x' } }));
    expect(where()).toHaveTextContent('Local checkout on feat/x');
  });

  it.each([
    ['the branch is not known yet', () => new Promise(() => {})],
    ['it could not be read', () => Promise.reject(new Error('offline'))],
    ['it is not a repository', () => Promise.resolve({ branch: null })],
  ])('names no branch when %s', async (_case, answer) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.getGitBranch.mockImplementation(answer);
    draft();
    await show();
    expect(where().textContent).toBe('Local checkout');
  });

  it('has no name to ask with while the project list loads', async () => {
    projects.list = [];
    draft();
    await show();
    expect(screen.getByRole('heading').textContent).toBe('What’s next?');
  });

  it('follows the project picker, and keeps nothing of the last project', async () => {
    aui.threads.threadItems = [session('a'), session('b', {}, { projectId: 'p2' })];
    draft();
    await show();
    expect(rows('sessions-welcome-recent')).toEqual(['Session a1d']);
    setProject('p2');
    await flush();
    expect(screen.getByRole('heading')).toHaveTextContent('What’s next for contabil?');
    expect(rows('sessions-welcome-recent')).toEqual(['Session b1d']);
  });

  it('says there is no project, and asks for one', async () => {
    aui.threads.threadItems = [session('scratch', {}, { noProject: true })];
    draft({ projectId: null });
    await show();
    expect(screen.getByRole('heading').textContent).toBe('What’s next?');
    expect(screen.getByTestId('sessions-welcome-tile')).toHaveTextContent('–');
    expect(where()).toHaveTextContent('No project: the agent works without a repository');
    expect(screen.getByTestId('sessions-welcome')).toHaveTextContent('Pick a project below');
    expect(screen.queryByTestId('sessions-welcome-recent')).toBeNull();
    expect(api.listTodos).not.toHaveBeenCalled();
  });

  it('says a temporary session without a project is deleted when closed', async () => {
    draft({ projectId: null, temporary: true });
    await show();
    expect(where()).toHaveTextContent('deleted when closed');
  });

  it('asks for a project while none was chosen', async () => {
    await show();
    expect(where()).toHaveTextContent('Choose a project to get started.');
  });
});

describe('recent sessions', () => {
  it('are the project’s three most recent, with their status or time', async () => {
    const now = Date.now();
    aui.threads.threadItems = [
      session('old', {}, { updatedAt: now - 9 * DAY }),
      session('idle', {}, { updatedAt: now - 3 * DAY }),
      session('running', {}, { updatedAt: now - DAY, displayStatus: 'working' }),
      session('waiting', {}, { updatedAt: now, displayStatus: 'waiting', hasPending: true }),
      session('other', {}, { projectId: 'p2', updatedAt: now }),
      session('archived', { status: 'archived' }, { updatedAt: now }),
      { id: 'local-1', status: 'new' },
    ];
    draft();
    await show();
    expect(rows('sessions-welcome-recent')).toEqual([
      'Session waitingneeds you',
      'Session runningrunning',
      'Session idle3d',
    ]);
    expect(screen.getByRole('group', { name: 'Continue in mainframe' })).toBeInTheDocument();
  });

  it('leave out a delegated task that lives in its parent', async () => {
    aui.threads.threadItems = [
      session('parent', {}, { updatedAt: 1 }),
      session('task', {}, { delegation: { taskId: 't' }, parentChatId: 'parent', updatedAt: 2 }),
    ];
    draft();
    await show();
    expect(screen.queryByTestId('sessions-welcome-session-task')).toBeNull();
    expect(screen.getByTestId('sessions-welcome-session-parent')).toBeInTheDocument();
  });

  it('open on a click', async () => {
    aui.threads.threadItems = [session('a')];
    draft();
    await show();
    fireEvent.click(screen.getByTestId('sessions-welcome-session-a'));
    expect(aui.switchToThread).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('say they are loading before the first answer', async () => {
    useSessionListLoadState.setState({ loaded: false });
    aui.threads.isLoading = true;
    draft();
    await show();
    expect(screen.getByTestId('sessions-welcome-recent')).toHaveTextContent('Loading recent sessions…');
  });

  it('say nothing of a project that has none', async () => {
    aui.threads.isLoading = true; // a reload
    draft();
    await show();
    expect(screen.queryByTestId('sessions-welcome-recent')).toBeNull();
  });

  it('say they could not be loaded, and try again', async () => {
    useSessionListLoadState.setState({ failed: true });
    draft();
    await show();
    expect(screen.getByTestId('sessions-welcome-recent')).toHaveTextContent('Couldn’t load recent sessions.');
    fireEvent.click(screen.getByTestId('sessions-welcome-recent-retry'));
    expect(aui.reload).toHaveBeenCalledOnce();
  });

  it('stay when only the latest refresh failed', async () => {
    useSessionListLoadState.setState({ failed: true });
    aui.threads.threadItems = [session('a')];
    draft();
    await show();
    expect(screen.getByTestId('sessions-welcome-recent')).not.toHaveTextContent('Couldn’t load');
  });
});

describe('project tasks', () => {
  it('are the three newest open ones', async () => {
    api.listTodos.mockResolvedValue([
      todo(20),
      todo(21),
      todo(22),
      todo(25, { status: 'in_progress' }),
      todo(26, { status: 'done' }),
      todo(24),
    ]);
    draft();
    await show();
    expect(rows('sessions-welcome-tasks')).toEqual(['Task 24#24', 'Task 22#22', 'Task 21#21']);
    expect(api.listTodos).toHaveBeenCalledWith(1, 'p1');
  });

  it('go into an empty composer, and focus it', async () => {
    api.listTodos.mockResolvedValue([todo(24)]);
    draft();
    await show();
    fireEvent.click(screen.getByTestId('sessions-welcome-task-24'));
    expect(aui.text).toBe('Work on task #24: Task 24');
    expect(focus).toHaveBeenCalledOnce();
  });

  it('never replace what was typed, and go in once', async () => {
    api.listTodos.mockResolvedValue([todo(24), todo(22)]);
    aui.text = 'Careful with the cache\n';
    draft();
    await show();
    fireEvent.click(screen.getByTestId('sessions-welcome-task-24'));
    fireEvent.click(screen.getByTestId('sessions-welcome-task-24'));
    expect(aui.text).toBe('Careful with the cache\n\nWork on task #24: Task 24');
    fireEvent.click(screen.getByTestId('sessions-welcome-task-22'));
    expect(aui.text).toBe('Careful with the cache\n\nWork on task #24: Task 24\n\nWork on task #22: Task 22');
  });

  it('say they are loading, then nothing when there are none', async () => {
    let answer: (todos: Todo[]) => void = () => {};
    api.listTodos.mockReturnValue(new Promise<Todo[]>((resolve) => (answer = resolve)));
    draft();
    await show();
    expect(screen.getByTestId('sessions-welcome-tasks')).toHaveTextContent('Loading project tasks…');
    await act(async () => answer([]));
    expect(screen.queryByTestId('sessions-welcome-tasks')).toBeNull();
  });

  it('say they could not be loaded, and try again', async () => {
    api.listTodos.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([todo(24)]);
    draft();
    await show();
    expect(screen.getByTestId('sessions-welcome-tasks')).toHaveTextContent('Couldn’t load project tasks.');
    fireEvent.click(screen.getByTestId('sessions-welcome-tasks-retry'));
    await waitFor(() => expect(rows('sessions-welcome-tasks')).toEqual(['Task 24#24']));
  });

  it('never show under another project, whichever answers last', async () => {
    const answers: Record<string, (todos: Todo[]) => void> = {};
    api.listTodos.mockImplementation((_port: number, id: string) => new Promise((resolve) => (answers[id] = resolve)));
    draft();
    await show();
    setProject('p2');
    await act(async () => answers['p2']!([todo(7)]));
    await act(async () => answers['p1']!([todo(24)]));
    expect(rows('sessions-welcome-tasks')).toEqual(['Task 7#7']);
  });

  it('are still loading for a project whose answer has not come, after another’s did', async () => {
    const answers: Record<string, (todos: Todo[]) => void> = {};
    api.listTodos.mockImplementation((_port: number, id: string) => new Promise((resolve) => (answers[id] = resolve)));
    draft();
    await show();
    setProject('p2');
    await act(async () => answers['p1']!([]));
    expect(screen.getByTestId('sessions-welcome-tasks')).toHaveTextContent('Loading project tasks…');
  });
});

it('offers no generic prompts', async () => {
  draft();
  await show();
  expect(screen.queryAllByRole('button')).toEqual([]);
});
