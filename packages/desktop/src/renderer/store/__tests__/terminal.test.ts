import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminalStore } from '../terminal';

describe('useTerminalStore', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      terminalsByProject: new Map(),
      activeTerminalByProject: new Map(),
    });
  });

  describe('getTerminals', () => {
    it('returns the same empty array reference on repeated calls for an unknown project', () => {
      // Regression: returning a fresh `[]` from the selector caused
      // useSyncExternalStore to detect a new snapshot every render, triggering
      // React error #185 (Maximum update depth exceeded) in TerminalPanel.
      const { getTerminals } = useTerminalStore.getState();
      const a = getTerminals('proj-1');
      const b = getTerminals('proj-1');
      const c = getTerminals('proj-2');
      expect(a).toBe(b);
      expect(a).toBe(c);
    });

    it('returns the stored array when the project has terminals', () => {
      const { addTerminal, getTerminals } = useTerminalStore.getState();
      addTerminal('proj-1', { id: 't1', name: 'zsh' });
      const list = getTerminals('proj-1');
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual({ id: 't1', name: 'zsh' });
    });
  });

  describe('addTerminal', () => {
    it('caps tabs per project at 3, dropping the oldest', () => {
      const { addTerminal, getTerminals } = useTerminalStore.getState();
      addTerminal('p', { id: '1', name: 'a' });
      addTerminal('p', { id: '2', name: 'b' });
      addTerminal('p', { id: '3', name: 'c' });
      addTerminal('p', { id: '4', name: 'd' });
      expect(getTerminals('p').map((t) => t.id)).toEqual(['2', '3', '4']);
    });

    it('sets the new tab as active', () => {
      const { addTerminal, getActiveTerminalId } = useTerminalStore.getState();
      addTerminal('p', { id: 't1', name: 'zsh' });
      expect(getActiveTerminalId('p')).toBe('t1');
    });
  });

  describe('removeTerminal', () => {
    it('promotes the last remaining tab when active is removed', () => {
      const { addTerminal, removeTerminal, getActiveTerminalId } = useTerminalStore.getState();
      addTerminal('p', { id: '1', name: 'a' });
      addTerminal('p', { id: '2', name: 'b' });
      removeTerminal('p', '2');
      expect(getActiveTerminalId('p')).toBe('1');
    });

    it('sets active to null when the last tab is removed', () => {
      const { addTerminal, removeTerminal, getActiveTerminalId } = useTerminalStore.getState();
      addTerminal('p', { id: '1', name: 'a' });
      removeTerminal('p', '1');
      expect(getActiveTerminalId('p')).toBeNull();
    });
  });
});
