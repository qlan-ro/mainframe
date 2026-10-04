import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import * as todosApi from '@/lib/api/todos';
import { TaskEditModal as SidebarTaskEditModal } from '../sidebar/TaskEditModal';
import { QuickTaskDialog } from '../QuickTaskDialog';

vi.mock('@/lib/api/todos', () => ({
  listTodos: vi.fn().mockResolvedValue([]),
  createTodo: vi.fn().mockResolvedValue({ id: 'new-task' }),
  updateTodo: vi.fn().mockResolvedValue(undefined),
  listAttachments: vi.fn().mockResolvedValue([]),
}));

const sizes = {
  tasks: { width: 900, height: 700 },
  'tasks-sidebar-edit': { width: 650, height: 640 },
  'tasks-quick': { width: 580, height: 510 },
};
const editors = [{ name: 'sidebar', key: 'tasks-sidebar-edit', Component: SidebarTaskEditModal }] as const;
const longDescription = Array.from({ length: 100 }, (_, index) => `Description line ${index + 1}`).join('\n');
const todo: todosApi.Todo = {
  id: 'task-1',
  number: 1,
  project_id: 'proj-1',
  title: 'Long task',
  body: longDescription,
  status: 'open',
  type: 'feature',
  priority: 'medium',
  labels: [],
  assignees: [],
  milestone: null,
  dependencies: [],
  order_index: 0,
  created_at: '',
  updated_at: '',
};

async function editLastLine(testId: string, paste: boolean) {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const user = userEvent.setup();
  const field = screen.getByTestId(testId);
  await user.click(field);
  if (paste) await user.paste(longDescription);
  await user.keyboard('{Control>}{End}{/Control} revised');
  expect(field).toHaveValue(`${longDescription} revised`);
  return user;
}

function QuickTaskHarness({ unresolved = false }: { unresolved?: boolean }) {
  const [projectId, setProjectId] = useState<string | null>(unresolved ? null : 'proj-1');
  const [open, setOpen] = useState(true);
  return (
    <QuickTaskDialog
      port={31415}
      projectId={projectId}
      projects={[{ id: 'proj-1', name: 'Mainframe', path: '/project', createdAt: '', lastOpenedAt: '' }]}
      filterProjectId={null}
      onSelectProject={setProjectId}
      open={open}
      onClose={() => setOpen(false)}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useUiPrefs.setState({ dialogSizes: sizes });
});

it('enables Quick Task resizing after project selection and closes without leaving the page locked', async () => {
  const user = userEvent.setup();
  render(<QuickTaskHarness unresolved />);
  const dialog = screen.getByRole('dialog');
  expect(screen.queryByTestId('dialog-resize-grabber-tasks-quick')).not.toBeInTheDocument();

  await user.click(screen.getByTestId('tasks-quick-project-proj-1'));

  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(screen.getByTestId('dialog-resize-grabber-tasks-quick')).toBeInTheDocument();
  expect(dialog).toHaveStyle({ width: '580px', height: '510px' });
  expect(screen.getByTestId('tasks-quick-title')).toBeInTheDocument();
  await user.click(screen.getByTestId('dialog-close'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body.style.pointerEvents).not.toBe('none');
  expect(useUiPrefs.getState().dialogSizes).toEqual(sizes);
});

it.each(editors)(
  '$name restores its own saved size without changing other dialog preferences',
  ({ key, Component }) => {
    render(<Component port={31415} projectId="proj-1" allTodos={[]} allLabels={[]} onClose={vi.fn()} />);

    expect(screen.getByTestId(`dialog-resize-grabber-${key}`)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveStyle({
      width: `${sizes[key].width}px`,
      height: `${sizes[key].height}px`,
    });
    expect(useUiPrefs.getState().dialogSizes).toEqual(sizes);
  },
);

it.each(editors)('$name keeps a dragged size on reopen without overwriting other dialogs', ({ key, Component }) => {
  const props = { port: 31415, projectId: 'proj-1', allTodos: [], allLabels: [], onClose: vi.fn() };
  const view = render(<Component {...props} />);
  const dialog = screen.getByRole('dialog');
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 650, 640));

  fireEvent.pointerDown(screen.getByTestId(`dialog-resize-grabber-${key}`), {
    button: 0,
    clientX: 650,
    clientY: 640,
  });
  fireEvent.pointerMove(window, { clientX: 680, clientY: 660 });
  fireEvent.pointerUp(window);
  view.unmount();
  render(<Component {...props} />);

  expect(screen.getByRole('dialog')).toHaveStyle({ width: '710px', height: '680px' });
  expect(useUiPrefs.getState().dialogSizes).toEqual({ ...sizes, [key]: { width: 710, height: 680 } });
});

describe.each(editors)('$name task description', ({ Component }) => {
  it.each(['create', 'edit'] as const)('preserves all 100 description lines when submitting %s', async (mode) => {
    const onClose = vi.fn();
    render(
      <Component
        port={31415}
        projectId="proj-1"
        todo={mode === 'edit' ? todo : null}
        allTodos={[]}
        allLabels={[]}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByTestId('tasks-edit-title'), { target: { value: 'Long task' } });
    const user = await editLastLine('tasks-edit-body', mode === 'create');
    await user.click(screen.getByTestId('tasks-edit-save'));

    const input = expect.objectContaining({ title: 'Long task', body: `${longDescription} revised` });
    await waitFor(() => {
      if (mode === 'edit') expect(todosApi.updateTodo).toHaveBeenCalledWith(31415, 'task-1', input);
      else expect(todosApi.createTodo).toHaveBeenCalledWith(31415, input);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});

it('preserves all 100 description lines when creating a Quick Task', async () => {
  render(<QuickTaskHarness />);
  fireEvent.change(screen.getByTestId('tasks-quick-title'), { target: { value: 'Long task' } });
  const user = await editLastLine('tasks-quick-body', true);
  await user.click(screen.getByTestId('tasks-quick-create'));

  await waitFor(() =>
    expect(todosApi.createTodo).toHaveBeenCalledWith(
      31415,
      expect.objectContaining({ projectId: 'proj-1', title: 'Long task', body: `${longDescription} revised` }),
    ),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
