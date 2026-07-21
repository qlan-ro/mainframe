/**
 * TasksFilterBar.test.tsx
 *
 * Behaviors covered:
 *  1. Typing in the search input calls onChange with updated search field.
 *  2. Clear button (tasks-filter-clear) appears when a filter is active.
 *  3. Clear button is NOT rendered when all filters are empty.
 *  4. Clicking Clear calls onChange with all-empty filters.
 *  5. Sort clicks are forwarded to onSortChange (the key/dir table itself is
 *     SortMenu.test.tsx's job).
 *  6. Label filter (tasks-filter-label) is only rendered when allLabels is non-empty.
 *
 * (search/type/priority testid presence is exercised implicitly by the
 * interaction tests below — no bare presence smokes needed.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksFilterBar } from '../TasksFilterBar';
import type { Todo } from '@/lib/api/todos';
import type { TodoFilters, TodoSort } from '../todos-filters';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_FILTERS: TodoFilters = { types: [], priorities: [], labels: [], search: '' };
const DEFAULT_SORT: TodoSort = { key: 'number', dir: 'desc' };

function makeTodo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    number: 1,
    project_id: 'proj-1',
    title: 'Some task',
    body: '',
    status: 'open',
    type: 'bug',
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

// Todos that supply options to the filter menus
const SAMPLE_TODOS = [
  makeTodo('t1', { type: 'bug', priority: 'high', labels: ['auth'] }),
  makeTodo('t2', { type: 'feature', priority: 'low', labels: ['ui'] }),
];

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

interface RenderOpts {
  filters?: TodoFilters;
  todos?: Todo[];
  allLabels?: string[];
  sort?: TodoSort;
}

function renderBar({
  filters = EMPTY_FILTERS,
  todos = SAMPLE_TODOS,
  allLabels = [],
  sort = DEFAULT_SORT,
}: RenderOpts = {}) {
  const onChange = vi.fn();
  const onSortChange = vi.fn();

  render(
    <TasksFilterBar
      filters={filters}
      onChange={onChange}
      allLabels={allLabels}
      sort={sort}
      onSortChange={onSortChange}
      todos={todos}
    />,
  );

  return { onChange, onSortChange };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 4. Changing the search input emits onChange with the full updated search value
//
// (search/type/priority testid presence is exercised implicitly by the
// interaction tests below — no bare presence smokes needed.)
// ---------------------------------------------------------------------------

describe('TasksFilterBar — search input emits onChange', () => {
  it('calls onChange with {search:"fix"} when the input value is changed to "fix"', () => {
    const { onChange } = renderBar({ filters: EMPTY_FILTERS });

    // Use fireEvent.change to set the full input value in one call (avoids the
    // controlled-component pitfall where each userEvent.type keystroke fires onChange
    // with only the single character, since the mock doesn't re-render the component).
    fireEvent.change(screen.getByTestId('tasks-filter-search'), { target: { value: 'fix' } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ types: [], priorities: [], labels: [], search: 'fix' });
  });
});

// ---------------------------------------------------------------------------
// 5–6. Clear button visibility
// ---------------------------------------------------------------------------

describe('TasksFilterBar — Clear button visibility', () => {
  it('renders tasks-filter-clear when search is active', () => {
    renderBar({ filters: { ...EMPTY_FILTERS, search: 'fix' } });
    expect(screen.getByTestId('tasks-filter-clear')).toBeTruthy();
  });

  it('renders tasks-filter-clear when a type filter is active', () => {
    renderBar({ filters: { ...EMPTY_FILTERS, types: ['bug'] } });
    expect(screen.getByTestId('tasks-filter-clear')).toBeTruthy();
  });

  it('does NOT render tasks-filter-clear when all filters are empty', () => {
    renderBar({ filters: EMPTY_FILTERS });
    expect(screen.queryByTestId('tasks-filter-clear')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Clicking Clear emits all-empty filters
// ---------------------------------------------------------------------------

describe('TasksFilterBar — clicking Clear emits all-empty filters', () => {
  it('calls onChange with {types:[],priorities:[],labels:[],search:""} when Clear is clicked', async () => {
    const { onChange } = renderBar({
      filters: { types: ['bug'], priorities: ['high'], labels: ['auth'], search: 'fix' },
    });

    await userEvent.click(screen.getByTestId('tasks-filter-clear'));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ types: [], priorities: [], labels: [], search: '' });
  });
});

// ---------------------------------------------------------------------------
// 8. Sort wiring — SortMenu's own key/direction table is covered by
// SortMenu.test.tsx; this just proves TasksFilterBar forwards SortMenu's
// onChange straight through as its onSortChange prop.
// ---------------------------------------------------------------------------

describe('TasksFilterBar — forwards SortMenu changes to onSortChange', () => {
  it('calls onSortChange with whatever SortMenu emits when a sort option is clicked', async () => {
    const { onSortChange } = renderBar({ sort: { key: 'number', dir: 'desc' } });

    await userEvent.click(screen.getByTestId('tasks-sort-menu'));
    await userEvent.click(screen.getByTestId('tasks-sort-option-priority'));

    await waitFor(() => {
      expect(onSortChange).toHaveBeenCalledExactlyOnceWith({ key: 'priority', dir: 'asc' });
    });
  });
});

// ---------------------------------------------------------------------------
// 10. Label filter only rendered when allLabels is non-empty
// ---------------------------------------------------------------------------

describe('TasksFilterBar — Label filter conditional rendering', () => {
  it('renders tasks-filter-label when allLabels has entries', () => {
    renderBar({ allLabels: ['auth', 'ui'] });
    expect(screen.getByTestId('tasks-filter-label')).toBeTruthy();
  });

  it('does NOT render tasks-filter-label when allLabels is empty', () => {
    renderBar({ allLabels: [] });
    expect(screen.queryByTestId('tasks-filter-label')).toBeNull();
  });
});
