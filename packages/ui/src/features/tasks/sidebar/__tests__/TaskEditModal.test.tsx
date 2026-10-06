/**
 * TaskEditModal — create-mode project picker.
 *
 * Multi-project Tasks: when CREATING with more than one project in the
 * scope, the modal gets a "Project" field (avatar chips, `TaskProjectChips`,
 * 2026-10 redesign — replaces the old Select dropdown) defaulted to the
 * caller-resolved `projectId` prop, that the user can retarget before saving.
 * Editing an existing todo never shows it.
 *
 * Behaviors covered:
 *  1. No field with a single candidate project.
 *  2. A field, defaulted to the `projectId` prop, with more than one.
 *  3. Clicking another avatar retargets where `create` writes.
 *  4. Never shown while editing, even with more than one candidate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@qlan-ro/mainframe-types';
import { TaskEditModal } from '../TaskEditModal';
import { useTodosStore } from '../../use-todos-store';
import * as todosApi from '@/lib/api/todos';
import type { Todo } from '@/lib/api/todos';

vi.mock('@/lib/api/todos', () => ({
  listTodos: vi.fn().mockResolvedValue([]),
  createTodo: vi.fn().mockResolvedValue({ id: 'new-task' }),
  updateTodo: vi.fn().mockResolvedValue(undefined),
  deleteTodo: vi.fn().mockResolvedValue(undefined),
  moveTodo: vi.fn(),
  listAttachments: vi.fn().mockResolvedValue([]),
  uploadAttachment: vi.fn(),
}));

const PROJECTS: Project[] = [
  { id: 'proj-1', name: 'Mainframe', path: '/repos/mainframe' } as Project,
  { id: 'proj-2', name: 'Sidecar', path: '/repos/sidecar' } as Project,
];

const TODO: Todo = {
  id: 'task-1',
  number: 1,
  project_id: 'proj-1',
  title: 'Existing task',
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
};

beforeEach(() => {
  vi.clearAllMocks();
  useTodosStore.setState({ entries: {} });
});

describe('TaskEditModal — create mode, a single candidate project', () => {
  it('renders no project field', () => {
    render(
      <TaskEditModal
        port={31415}
        projectId="proj-1"
        allTodos={[]}
        allLabels={[]}
        projects={[PROJECTS[0]!]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('tasks-edit-project')).toBeNull();
  });
});

describe('TaskEditModal — create mode, more than one candidate project', () => {
  it('renders avatar chips, with the projectId prop pre-selected', () => {
    render(
      <TaskEditModal
        port={31415}
        projectId="proj-1"
        allTodos={[]}
        allLabels={[]}
        projects={PROJECTS}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('tasks-edit-project')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-edit-project-proj-1')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('tasks-edit-project-proj-2')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Mainframe')).toBeInTheDocument();
  });

  it('writes the create to the retargeted project once another avatar is clicked', async () => {
    render(
      <TaskEditModal
        port={31415}
        projectId="proj-1"
        allTodos={[]}
        allLabels={[]}
        projects={PROJECTS}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId('tasks-edit-project-proj-2'));
    expect(screen.getByTestId('tasks-edit-project-proj-2')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('tasks-edit-project-proj-1')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Sidecar')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('tasks-edit-title'), 'Cross-project task');
    await userEvent.click(screen.getByTestId('tasks-edit-save'));

    await waitFor(() =>
      expect(todosApi.createTodo).toHaveBeenCalledWith(
        31415,
        expect.objectContaining({ title: 'Cross-project task', projectId: 'proj-2' }),
      ),
    );
  });
});

describe('TaskEditModal — edit mode', () => {
  it('renders no project field even with more than one candidate project', () => {
    render(
      <TaskEditModal
        port={31415}
        projectId="proj-1"
        todo={TODO}
        allTodos={[TODO]}
        allLabels={[]}
        projects={PROJECTS}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('tasks-edit-project')).toBeNull();
  });
});
