/**
 * TasksCard — unit tests.
 *
 * The project's active tasks as a stacked panel (todo item 4). The card owns
 * the project-scoped todos load now that the sidebar section is gone.
 *
 * Behaviors covered:
 *  - without an active project: the "No active project" row, no New-task row,
 *    and no load at all — there is nothing to scope to
 *  - with a project but no active tasks: the New-task row plus the empty row
 *  - one row per ACTIVE todo; done todos never appear, and neither does the
 *    done count in the badge
 *  - a row opens the edit modal on that todo; New task opens the create form
 *  - the header X closes the panel
 *
 * Follows TasksModalHost.test.tsx: the REAL useTodosStore runs against a mocked
 * lib/api/todos, so the load the card fires is observable. The edit modal is
 * stubbed — it owns its own suite.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Todo } from '@/lib/api/todos';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';

vi.mock('@/lib/api/todos', () => ({
  listTodos: vi.fn(),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  moveTodo: vi.fn(),
  deleteTodo: vi.fn(),
  uploadAttachment: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn(), success: vi.fn() } }));

let mockProjectId: string | undefined = 'proj-1';
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectName: 'repo', projectId: mockProjectId, chatId: 'chat-9', isWorktree: false }),
}));

const startTodoSession = vi.fn();
vi.mock('@/features/tasks/use-start-todo-session', () => ({
  useStartTodoSession: () => startTodoSession,
}));

// The real dialog owns its own suite; here only "which todo did it open on?"
// matters. `null` is the create form, a Todo is an edit.
vi.mock('@/features/tasks/sidebar/TaskEditModal', () => ({
  TaskEditModal: ({ todo }: { todo: { id: string } | null }) => (
    <div data-testid="task-edit-modal-stub" data-todo={todo ? todo.id : 'new'} />
  ),
}));

const { TasksCard } = await import('../TasksCard');
const { useTodosStore } = await import('@/features/tasks/use-todos-store');
const todosApi = await import('@/lib/api/todos');
const { mfToast } = await import('@/lib/toast');

function makeTodo(overrides: Partial<Todo> & { id: string; number: number }): Todo {
  return {
    project_id: 'proj-1',
    title: 'Default title',
    body: '',
    status: 'open',
    type: 'feature',
    priority: 'medium',
    labels: [],
    assignees: [],
    milestone: null,
    dependencies: [],
    order_index: 0,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

const OPEN_TODO = makeTodo({ id: 'todo-1', number: 11, title: 'Fix the rail', status: 'open' });
const IN_PROGRESS_TODO = makeTodo({ id: 'todo-2', number: 12, title: 'Ship the stack', status: 'in_progress' });
const DONE_TODO = makeTodo({ id: 'todo-3', number: 13, title: 'Old work', status: 'done' });

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DaemonPortProvider port={31415}>
      <TooltipProvider>{children}</TooltipProvider>
    </DaemonPortProvider>
  );
}

const onClose = vi.fn();
const render = () => rtlRender(<TasksCard onClose={onClose} />, { wrapper: Wrapper });
const badge = () => screen.getByTestId('session-panel-card-tasks').querySelector('[data-slot="badge"]');

/** Renders and waits for the card's own load to land in the store. */
async function renderLoaded(todos: Todo[]) {
  vi.mocked(todosApi.listTodos).mockResolvedValue(todos);
  render();
  await waitFor(() => expect(todosApi.listTodos).toHaveBeenCalledWith(31415, 'proj-1'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProjectId = 'proj-1';
  vi.mocked(todosApi.listTodos).mockResolvedValue([]);
  // The store is a module-level singleton — a previous case's rows would leak.
  useTodosStore.setState({ todos: [], loading: false, error: null, loadedProjectId: null });
});

describe('TasksCard — no active project', () => {
  it('says so instead of rendering an empty list', async () => {
    mockProjectId = undefined;
    render();
    expect(screen.getByTestId('session-panel-tasks-no-project')).toHaveTextContent('No active project');
    expect(screen.queryByTestId('session-panel-tasks-new')).toBeNull();
    expect(screen.queryByTestId('session-panel-tasks-empty')).toBeNull();
  });

  it('loads nothing — there is no project to scope the load to', async () => {
    mockProjectId = undefined;
    render();
    expect(todosApi.listTodos).not.toHaveBeenCalled();
  });

  it('shows no count badge', async () => {
    mockProjectId = undefined;
    render();
    expect(badge()).toBeNull();
  });
});

describe('TasksCard — empty project', () => {
  it('keeps the quick-add input and shows the empty row', async () => {
    await renderLoaded([]);
    await waitFor(() => expect(screen.getByTestId('session-panel-tasks-empty')).toHaveTextContent('No active tasks'));
    const input = screen.getByTestId('session-panel-tasks-new');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('placeholder', 'New task');
  });

  it('shows no count badge with nothing active', async () => {
    await renderLoaded([]);
    expect(badge()).toBeNull();
  });

  it('shows the empty row when every task is done', async () => {
    await renderLoaded([DONE_TODO]);
    await waitFor(() => expect(screen.getByTestId('session-panel-tasks-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('session-panel-task-row-13')).toBeNull();
  });
});

describe('TasksCard — rows', () => {
  it('renders one row per active task, keyed by its number', async () => {
    await renderLoaded([OPEN_TODO, IN_PROGRESS_TODO, DONE_TODO]);
    await waitFor(() => expect(screen.getByTestId('session-panel-task-row-11')).toHaveTextContent('Fix the rail'));
    expect(screen.getByTestId('session-panel-task-row-11')).toHaveTextContent('#11');
    expect(screen.getByTestId('session-panel-task-row-12')).toHaveTextContent('Ship the stack');
    // Done work is not "active" — it never reaches the panel.
    expect(screen.queryByTestId('session-panel-task-row-13')).toBeNull();
    expect(screen.queryByTestId('session-panel-tasks-empty')).toBeNull();
  });

  it('counts only the active tasks in the card badge', async () => {
    await renderLoaded([OPEN_TODO, IN_PROGRESS_TODO, DONE_TODO]);
    await waitFor(() => expect(badge()).toHaveTextContent('2'));
  });
});

describe('TasksCard — the edit modal', () => {
  it('stays closed until something asks for it', async () => {
    await renderLoaded([OPEN_TODO]);
    await waitFor(() => expect(screen.getByTestId('session-panel-task-row-11')).toBeInTheDocument());
    expect(screen.queryByTestId('task-edit-modal-stub')).toBeNull();
  });

  it('creates a title-only task on Enter and clears the input for the next one', async () => {
    await renderLoaded([OPEN_TODO]);
    await waitFor(() => expect(screen.getByTestId('session-panel-tasks-new')).toBeInTheDocument());
    const input = screen.getByTestId('session-panel-tasks-new');

    fireEvent.change(input, { target: { value: '  Ship the panel  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(todosApi.createTodo).toHaveBeenCalledWith(31415, { title: 'Ship the panel', projectId: 'proj-1' }),
    );
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('creates nothing on Enter with a blank draft', async () => {
    await renderLoaded([OPEN_TODO]);
    await waitFor(() => expect(screen.getByTestId('session-panel-tasks-new')).toBeInTheDocument());
    const input = screen.getByTestId('session-panel-tasks-new');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(todosApi.createTodo).not.toHaveBeenCalled();
  });

  const pasteImage = (input: HTMLElement, name = 'shot.png') => {
    const file = new File(['x'], name, { type: 'image/png' });
    fireEvent.paste(input, { clipboardData: { files: [file] } });
  };

  it('holds a pasted image and shows the count chip', async () => {
    await renderLoaded([]);
    const input = await screen.findByTestId('session-panel-tasks-new');

    pasteImage(input);

    await waitFor(() =>
      expect(screen.getByTestId('session-panel-tasks-attachments')).toHaveTextContent('1 attachment'),
    );
    pasteImage(input, 'shot-2.png');
    await waitFor(() =>
      expect(screen.getByTestId('session-panel-tasks-attachments')).toHaveTextContent('2 attachments'),
    );
  });

  it('discards the pending attachments from the chip', async () => {
    await renderLoaded([]);
    const input = await screen.findByTestId('session-panel-tasks-new');
    pasteImage(input);
    await waitFor(() => expect(screen.getByTestId('session-panel-tasks-attachments')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('session-panel-tasks-attachments-clear'));

    expect(screen.queryByTestId('session-panel-tasks-attachments')).toBeNull();
  });

  it('uploads the pending attachments to the created todo, then clears the chip', async () => {
    vi.mocked(todosApi.createTodo).mockResolvedValue({ ...OPEN_TODO, id: 'todo-new', number: 99 });
    vi.mocked(todosApi.uploadAttachment).mockResolvedValue({
      id: 'att-1',
      filename: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: 1,
    } as never);
    await renderLoaded([]);
    const input = await screen.findByTestId('session-panel-tasks-new');
    pasteImage(input);
    await waitFor(() => expect(screen.getByTestId('session-panel-tasks-attachments')).toBeInTheDocument());

    fireEvent.change(input, { target: { value: 'With screenshot' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(todosApi.uploadAttachment).toHaveBeenCalledWith(
        31415,
        'todo-new',
        expect.objectContaining({ filename: 'shot.png', mimeType: 'image/png' }),
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('session-panel-tasks-attachments')).toBeNull());
  });

  it('rejects a non-image paste and attaches nothing', async () => {
    await renderLoaded([]);
    const input = await screen.findByTestId('session-panel-tasks-new');
    const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' });

    fireEvent.paste(input, { clipboardData: { files: [file] } });

    await waitFor(() => expect(mfToast.error).toHaveBeenCalledWith('Attachment not added', expect.anything()));
    expect(screen.queryByTestId('session-panel-tasks-attachments')).toBeNull();
  });

  it('opens on the todo whose row was clicked', async () => {
    await renderLoaded([OPEN_TODO, IN_PROGRESS_TODO]);
    await waitFor(() => expect(screen.getByTestId('session-panel-task-row-12')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('session-panel-task-row-12'));
    expect(screen.getByTestId('task-edit-modal-stub')).toHaveAttribute('data-todo', 'todo-2');
  });
});

describe('TasksCard — card chrome', () => {
  it('titles the card Tasks and closes from the header X', async () => {
    await renderLoaded([]);
    expect(screen.getByTestId('session-panel-card-tasks')).toHaveTextContent('Tasks');
    fireEvent.click(screen.getByTestId('session-panel-card-close-tasks'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
