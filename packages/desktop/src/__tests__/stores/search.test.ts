import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchStore } from '../../renderer/store/search.js';

function resetStore(): void {
  useSearchStore.setState({
    isOpen: false,
    query: '',
    selectedIndex: 0,
  });
}

describe('useSearchStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('initial state', () => {
    it('starts closed', () => {
      expect(useSearchStore.getState().isOpen).toBe(false);
    });

    it('starts with empty query', () => {
      expect(useSearchStore.getState().query).toBe('');
    });

    it('starts with selectedIndex 0', () => {
      expect(useSearchStore.getState().selectedIndex).toBe(0);
    });
  });

  describe('open', () => {
    it('opens the search', () => {
      useSearchStore.getState().open();
      expect(useSearchStore.getState().isOpen).toBe(true);
    });
  });

  describe('close', () => {
    it('closes the search', () => {
      useSearchStore.getState().open();
      useSearchStore.getState().close();
      expect(useSearchStore.getState().isOpen).toBe(false);
    });

    it('resets query and selectedIndex on close', () => {
      useSearchStore.getState().open();
      useSearchStore.getState().setQuery('test');
      useSearchStore.getState().setSelectedIndex(5);
      useSearchStore.getState().close();
      expect(useSearchStore.getState().query).toBe('');
      expect(useSearchStore.getState().selectedIndex).toBe(0);
    });
  });

  describe('setQuery', () => {
    it('updates the query string', () => {
      useSearchStore.getState().setQuery('hello world');
      expect(useSearchStore.getState().query).toBe('hello world');
    });

    it('resets selectedIndex to 0 when query changes', () => {
      useSearchStore.getState().setSelectedIndex(3);
      useSearchStore.getState().setQuery('new query');
      expect(useSearchStore.getState().selectedIndex).toBe(0);
    });
  });

  describe('setSelectedIndex', () => {
    it('updates the selected index', () => {
      useSearchStore.getState().setSelectedIndex(5);
      expect(useSearchStore.getState().selectedIndex).toBe(5);
    });

    it('can set to 0', () => {
      useSearchStore.getState().setSelectedIndex(5);
      useSearchStore.getState().setSelectedIndex(0);
      expect(useSearchStore.getState().selectedIndex).toBe(0);
    });
  });
});
