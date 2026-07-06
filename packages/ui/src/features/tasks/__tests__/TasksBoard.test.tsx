/**
 * TasksBoard.test.tsx
 *
 * Behaviors covered:
 *  1.  Renders data-testid="tasks-board-modal".
 *  2.  Renders a close button (tasks-board-close) as the header's first
 *      interactive element, to the left of the "Tasks" title (finding 9.1).
 *  3.  Clicking the close button calls the onClose prop.
 *  4.  Renders tasks-view-list / tasks-view-board segmented switch.
 *  5.  Renders tasks-board-new button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock useTodosStore
// ---------------------------------------------------------------------------

const mockSetView = vi.fn();
const mockSetSort = vi.fn();
const mockSetFilters = vi.fn();

vi.mock('../use-todos-store', () => ({
  useTodosStore: vi.fn(() => ({
    todos: [],
    loading: false,
    filters: { types: [], priorities: [], labels: [], search: '' },
    sort: { key: 'priority', dir: 'asc' },
    view: 'list',
    move: vi.fn(),
    remove: vi.fn(),
    setFilters: mockSetFilters,
    setSort: mockSetSort,
    setView: mockSetView,
  })),
}));

// Stub the heavy child views — this file exercises TasksBoard's own header only.
vi.mock('../TaskListView', () => ({
  TaskListView: () => <div data-testid="task-list-view-stub" />,
}));
vi.mock('../TaskBoardView', () => ({
  TaskBoardView: () => <div data-testid="task-board-view-stub" />,
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { TasksBoard } from '../TasksBoard';

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderBoard(onClose = vi.fn()) {
  render(<TasksBoard port={31415} projectId="proj-1" onStartSession={vi.fn()} onClose={onClose} />);
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TasksBoard — root testid', () => {
  it('renders tasks-board-modal', () => {
    renderBoard();
    expect(screen.getByTestId('tasks-board-modal')).toBeTruthy();
  });
});

describe('TasksBoard — close button (finding 9.1)', () => {
  it('renders tasks-board-close', () => {
    renderBoard();
    expect(screen.getByTestId('tasks-board-close')).toBeTruthy();
  });

  it('positions the close button before the "Tasks" title in DOM order', () => {
    renderBoard();
    const header = screen.getByTestId('tasks-board-modal').firstElementChild as HTMLElement;
    const closeBtn = screen.getByTestId('tasks-board-close');
    const title = screen.getByText('Tasks');
    const children = Array.from(header.querySelectorAll('*'));
    expect(children.indexOf(closeBtn)).toBeLessThan(children.indexOf(title));
  });

  it('calls onClose when clicked', async () => {
    const { onClose } = renderBoard();
    await userEvent.click(screen.getByTestId('tasks-board-close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('TasksBoard — segmented view switch + new button still render', () => {
  it('renders tasks-view-list, tasks-view-board, tasks-board-new', () => {
    renderBoard();
    expect(screen.getByTestId('tasks-view-list')).toBeTruthy();
    expect(screen.getByTestId('tasks-view-board')).toBeTruthy();
    expect(screen.getByTestId('tasks-board-new')).toBeTruthy();
  });
});

describe('TasksBoard — header spacing (design parity)', () => {
  it('applies 16px horizontal padding to the header', () => {
    renderBoard();
    const header = screen.getByTestId('tasks-board-modal').firstElementChild as HTMLElement;
    expect(header.className).toContain('px-[16px]');
    expect(header.className).not.toContain('px-4');
  });

  it('renders the active/done count chip with an 8px radius and 8px horizontal padding', () => {
    renderBoard();
    const chip = screen.getByText(/active/).closest('span') as HTMLElement;
    expect(chip.className).toContain('rounded-md');
    expect(chip.className).not.toContain('rounded-sm');
    expect(chip.className).toContain('px-[8px]');
    expect(chip.className).toContain('py-0.5');
  });
});
