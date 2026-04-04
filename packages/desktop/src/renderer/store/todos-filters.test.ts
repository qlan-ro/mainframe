import { describe, it, expect, beforeEach } from 'vitest';
import { useTodosFilterStore } from './todos-filters';

describe('useTodosFilterStore', () => {
  beforeEach(() => {
    useTodosFilterStore.getState().resetFilters();
  });

  it('starts with empty filters and default sort', () => {
    const { filters, sort } = useTodosFilterStore.getState();
    expect(filters).toEqual({ types: [], priorities: [], labels: [], search: '' });
    expect(sort).toEqual({ key: 'number', dir: 'desc' });
  });

  it('setFilters updates filters', () => {
    useTodosFilterStore.getState().setFilters({ types: ['bug'], priorities: [], labels: [], search: 'test' });
    expect(useTodosFilterStore.getState().filters.types).toEqual(['bug']);
    expect(useTodosFilterStore.getState().filters.search).toBe('test');
  });

  it('setSort updates sort', () => {
    useTodosFilterStore.getState().setSort({ key: 'priority', dir: 'asc' });
    expect(useTodosFilterStore.getState().sort).toEqual({ key: 'priority', dir: 'asc' });
  });

  it('resetFilters restores defaults', () => {
    useTodosFilterStore.getState().setFilters({ types: ['bug'], priorities: ['high'], labels: [], search: '' });
    useTodosFilterStore.getState().setSort({ key: 'priority', dir: 'asc' });
    useTodosFilterStore.getState().resetFilters();
    expect(useTodosFilterStore.getState().filters).toEqual({ types: [], priorities: [], labels: [], search: '' });
    expect(useTodosFilterStore.getState().sort).toEqual({ key: 'number', dir: 'desc' });
  });
});
