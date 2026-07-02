/**
 * todos-filters.test.ts
 *
 * Behaviors covered (all with hardcoded inputs and expected outputs):
 *
 * matchesFilters:
 *  1.  Empty filters — every todo passes.
 *  2.  Type filter — only todos whose type is in the list pass.
 *  3.  Priority filter — only todos whose priority is in the list pass.
 *  4.  Label filter — any-match: passes when at least one label overlaps.
 *  5.  Search filter — matches title (case-insensitive); does NOT match body or number.
 *  6.  Combined filters — all active conditions must match (AND logic).
 *
 * sortTodos:
 *  7.  Sort by number ascending — lower number first.
 *  8.  Sort by number descending — higher number first.
 *  9.  Sort by priority ascending — low < medium < high < critical.
 *  10. Sort by priority descending — critical < high < medium < low.
 *  11. Sort by type ascending — alphabetical.
 *  12. Does not mutate the original array.
 *
 * extractAllLabels:
 *  13. Returns unique labels sorted alphabetically.
 *  14. Returns [] for todos with no labels.
 *  15. Handles todos that share some labels (deduplication).
 */
import { describe, it, expect } from 'vitest';
import { matchesFilters, sortTodos, extractAllLabels } from '../todos-filters';
import type { Todo } from '@/lib/api/todos';
import type { TodoFilters, TodoSort } from '../todos-filters';

// ---------------------------------------------------------------------------
// Fixtures — concrete, hardcoded todos
// ---------------------------------------------------------------------------

function makeTodo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    number: 1,
    project_id: 'proj-1',
    title: 'Default title',
    body: 'Default body',
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

const EMPTY_FILTERS: TodoFilters = { types: [], priorities: [], labels: [], search: '' };

// ---------------------------------------------------------------------------
// matchesFilters — empty filters
// ---------------------------------------------------------------------------

describe('matchesFilters — empty filters pass everything', () => {
  it('returns true for a bug with high priority when all filter arrays are empty', () => {
    const todo = makeTodo({ id: 't1', type: 'bug', priority: 'high' });
    expect(matchesFilters(todo, EMPTY_FILTERS)).toBe(true);
  });

  it('returns true for a feature with low priority when all filter arrays are empty', () => {
    const todo = makeTodo({ id: 't2', type: 'feature', priority: 'low' });
    expect(matchesFilters(todo, EMPTY_FILTERS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesFilters — type filter
// ---------------------------------------------------------------------------

describe('matchesFilters — type filter', () => {
  it('passes a todo whose type is in the filter list', () => {
    const todo = makeTodo({ id: 't1', type: 'bug' });
    const filters: TodoFilters = { ...EMPTY_FILTERS, types: ['bug', 'feature'] };
    expect(matchesFilters(todo, filters)).toBe(true);
  });

  it('rejects a todo whose type is NOT in the filter list', () => {
    const todo = makeTodo({ id: 't1', type: 'documentation' });
    const filters: TodoFilters = { ...EMPTY_FILTERS, types: ['bug', 'feature'] };
    expect(matchesFilters(todo, filters)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesFilters — priority filter
// ---------------------------------------------------------------------------

describe('matchesFilters — priority filter', () => {
  it('passes a critical-priority todo when the filter includes critical', () => {
    const todo = makeTodo({ id: 't1', priority: 'critical' });
    const filters: TodoFilters = { ...EMPTY_FILTERS, priorities: ['critical', 'high'] };
    expect(matchesFilters(todo, filters)).toBe(true);
  });

  it('rejects a low-priority todo when the filter only includes critical and high', () => {
    const todo = makeTodo({ id: 't1', priority: 'low' });
    const filters: TodoFilters = { ...EMPTY_FILTERS, priorities: ['critical', 'high'] };
    expect(matchesFilters(todo, filters)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesFilters — label filter (any-match)
// ---------------------------------------------------------------------------

describe('matchesFilters — label filter uses any-match semantics', () => {
  it('passes when the todo has at least one of the filtered labels', () => {
    const todo = makeTodo({ id: 't1', labels: ['auth', 'backend'] });
    const filters: TodoFilters = { ...EMPTY_FILTERS, labels: ['auth'] };
    expect(matchesFilters(todo, filters)).toBe(true);
  });

  it('rejects when the todo shares none of the filtered labels', () => {
    const todo = makeTodo({ id: 't1', labels: ['frontend', 'ui'] });
    const filters: TodoFilters = { ...EMPTY_FILTERS, labels: ['auth', 'backend'] };
    expect(matchesFilters(todo, filters)).toBe(false);
  });

  it('rejects when the todo has no labels at all', () => {
    const todo = makeTodo({ id: 't1', labels: [] });
    const filters: TodoFilters = { ...EMPTY_FILTERS, labels: ['auth'] };
    expect(matchesFilters(todo, filters)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesFilters — search filter (title only)
// ---------------------------------------------------------------------------

describe('matchesFilters — search is case-insensitive and matches title only', () => {
  it('passes when the search term appears in the title (case-insensitive)', () => {
    const todo = makeTodo({ id: 't1', title: 'Fix the SSO Login Bug' });
    const filters: TodoFilters = { ...EMPTY_FILTERS, search: 'sso login' };
    expect(matchesFilters(todo, filters)).toBe(true);
  });

  it('rejects when the search term does NOT appear in the title', () => {
    const todo = makeTodo({ id: 't1', title: 'Refactor database layer' });
    const filters: TodoFilters = { ...EMPTY_FILTERS, search: 'login' };
    expect(matchesFilters(todo, filters)).toBe(false);
  });

  it('does NOT match the body text — only the title is searched', () => {
    const todo = makeTodo({ id: 't1', title: 'Improve performance', body: 'login page is slow' });
    const filters: TodoFilters = { ...EMPTY_FILTERS, search: 'login' };
    // body contains "login" but title does not — must be rejected
    expect(matchesFilters(todo, filters)).toBe(false);
  });

  it('does NOT match the issue number — only the title is searched', () => {
    const todo = makeTodo({ id: 't1', number: 42, title: 'Update README' });
    const filters: TodoFilters = { ...EMPTY_FILTERS, search: '42' };
    // number is 42 but title does not contain "42" — must be rejected
    expect(matchesFilters(todo, filters)).toBe(false);
  });

  it('passes when the search string is empty (whitespace only)', () => {
    const todo = makeTodo({ id: 't1', title: 'Anything' });
    const filters: TodoFilters = { ...EMPTY_FILTERS, search: '   ' };
    expect(matchesFilters(todo, filters)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesFilters — combined filters (AND semantics)
// ---------------------------------------------------------------------------

describe('matchesFilters — combined filters all must match', () => {
  it('passes only when type, priority, label, AND search all match', () => {
    const todo = makeTodo({
      id: 't1',
      type: 'bug',
      priority: 'high',
      labels: ['auth'],
      title: 'Fix SSO',
    });
    const filters: TodoFilters = {
      types: ['bug'],
      priorities: ['high'],
      labels: ['auth'],
      search: 'sso',
    };
    expect(matchesFilters(todo, filters)).toBe(true);
  });

  it('rejects when type matches but priority does not', () => {
    const todo = makeTodo({ id: 't1', type: 'bug', priority: 'low', title: 'Fix SSO' });
    const filters: TodoFilters = { types: ['bug'], priorities: ['high'], labels: [], search: '' };
    expect(matchesFilters(todo, filters)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sortTodos — by number
// ---------------------------------------------------------------------------

describe('sortTodos — by number', () => {
  const todos = [
    makeTodo({ id: 'c', number: 30, title: 'C' }),
    makeTodo({ id: 'a', number: 5, title: 'A' }),
    makeTodo({ id: 'b', number: 12, title: 'B' }),
  ];

  it('ascending: returns [5, 12, 30] order', () => {
    const sort: TodoSort = { key: 'number', dir: 'asc' };
    const result = sortTodos(todos, sort);
    expect(result.map((t) => t.number)).toEqual([5, 12, 30]);
  });

  it('descending: returns [30, 12, 5] order', () => {
    const sort: TodoSort = { key: 'number', dir: 'desc' };
    const result = sortTodos(todos, sort);
    expect(result.map((t) => t.number)).toEqual([30, 12, 5]);
  });
});

// ---------------------------------------------------------------------------
// sortTodos — by priority
// ---------------------------------------------------------------------------

describe('sortTodos — by priority rank', () => {
  const todos = [
    makeTodo({ id: 'h', priority: 'high', title: 'H' }),
    makeTodo({ id: 'c', priority: 'critical', title: 'C' }),
    makeTodo({ id: 'l', priority: 'low', title: 'L' }),
    makeTodo({ id: 'm', priority: 'medium', title: 'M' }),
  ];

  // Rank matches the design's TD_PRI_RANK (critical=0 .. low=3), so ascending
  // surfaces the most urgent todo first — see finding 9.4.
  it('ascending: critical → high → medium → low (rank 0→3)', () => {
    const sort: TodoSort = { key: 'priority', dir: 'asc' };
    const result = sortTodos(todos, sort);
    expect(result.map((t) => t.priority)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('descending: low → medium → high → critical (rank 3→0)', () => {
    const sort: TodoSort = { key: 'priority', dir: 'desc' };
    const result = sortTodos(todos, sort);
    expect(result.map((t) => t.priority)).toEqual(['low', 'medium', 'high', 'critical']);
  });
});

// ---------------------------------------------------------------------------
// sortTodos — by type (alphabetical)
// ---------------------------------------------------------------------------

describe('sortTodos — by type alphabetically', () => {
  const todos = [
    makeTodo({ id: 'f', type: 'feature', title: 'F' }),
    makeTodo({ id: 'b', type: 'bug', title: 'B' }),
    makeTodo({ id: 'd', type: 'documentation', title: 'D' }),
  ];

  it('ascending: bug → documentation → feature', () => {
    const sort: TodoSort = { key: 'type', dir: 'asc' };
    const result = sortTodos(todos, sort);
    expect(result.map((t) => t.type)).toEqual(['bug', 'documentation', 'feature']);
  });

  it('descending: feature → documentation → bug', () => {
    const sort: TodoSort = { key: 'type', dir: 'desc' };
    const result = sortTodos(todos, sort);
    expect(result.map((t) => t.type)).toEqual(['feature', 'documentation', 'bug']);
  });
});

// ---------------------------------------------------------------------------
// sortTodos — does not mutate original
// ---------------------------------------------------------------------------

describe('sortTodos — does not mutate the input array', () => {
  it('returns a new array and leaves the original in its original order', () => {
    const original = [makeTodo({ id: 'z', number: 99, title: 'Z' }), makeTodo({ id: 'a', number: 1, title: 'A' })];
    const sort: TodoSort = { key: 'number', dir: 'asc' };

    sortTodos(original, sort);

    // original[0] must still be the item with number=99
    expect(original[0]?.number).toBe(99);
    expect(original[1]?.number).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// extractAllLabels
// ---------------------------------------------------------------------------

describe('extractAllLabels', () => {
  it('returns unique labels sorted alphabetically from multiple todos', () => {
    const todos = [
      makeTodo({ id: 't1', labels: ['backend', 'auth'] }),
      makeTodo({ id: 't2', labels: ['frontend', 'auth'] }),
      makeTodo({ id: 't3', labels: ['backend'] }),
    ];

    const result = extractAllLabels(todos);

    // 'auth', 'backend', 'frontend' — sorted, deduplicated
    expect(result).toEqual(['auth', 'backend', 'frontend']);
  });

  it('returns [] when no todos have labels', () => {
    const todos = [makeTodo({ id: 't1', labels: [] }), makeTodo({ id: 't2', labels: [] })];

    expect(extractAllLabels(todos)).toEqual([]);
  });

  it('returns [] for an empty todos array', () => {
    expect(extractAllLabels([])).toEqual([]);
  });

  it('deduplicates a label that appears in every todo', () => {
    const todos = [
      makeTodo({ id: 't1', labels: ['shared', 'alpha'] }),
      makeTodo({ id: 't2', labels: ['shared', 'beta'] }),
      makeTodo({ id: 't3', labels: ['shared'] }),
    ];

    const result = extractAllLabels(todos);

    // 'shared' appears 3 times but must appear once; sorted: alpha, beta, shared
    expect(result).toEqual(['alpha', 'beta', 'shared']);
  });
});
