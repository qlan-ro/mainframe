import { create } from 'zustand';
import type { TodoFilters, TodoSort } from '../components/todos/TodoFilterBar';

const DEFAULT_FILTERS: TodoFilters = { types: [], priorities: [], labels: [], search: '' };
const DEFAULT_SORT: TodoSort = { key: 'number', dir: 'desc' };

interface TodosFilterStore {
  filters: TodoFilters;
  sort: TodoSort;
  setFilters: (f: TodoFilters) => void;
  setSort: (s: TodoSort) => void;
  resetFilters: () => void;
}

export const useTodosFilterStore = create<TodosFilterStore>((set) => ({
  filters: { ...DEFAULT_FILTERS },
  sort: { ...DEFAULT_SORT },
  setFilters: (filters) => set({ filters }),
  setSort: (sort) => set({ sort }),
  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS }, sort: { ...DEFAULT_SORT } }),
}));
