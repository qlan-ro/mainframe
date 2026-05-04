import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminalStore } from '../terminal';

describe('useTerminalStore', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      terminalsByScope: new Map(),
      activeTerminalByScope: new Map(),
    });
  });

  describe('getTerminals', () => {
    it('returns the same empty array reference on repeated calls for an unknown scope', () => {
      // Regression: returning a fresh `[]` from the selector caused
      // useSyncExternalStore to detect a new snapshot every render, triggering
      // React error #185 (Maximum update depth exceeded) in TerminalPanel.
      const { getTerminals } = useTerminalStore.getState();
      const a = getTerminals('scope-1');
      const b = getTerminals('scope-1');
      const c = getTerminals('scope-2');
      expect(a).toBe(b);
      expect(a).toBe(c);
    });

    it('returns the stored array when the scope has terminals', () => {
      const { addTerminal, getTerminals } = useTerminalStore.getState();
      addTerminal('scope-1', { id: 't1', name: 'zsh' });
      const list = getTerminals('scope-1');
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual({ id: 't1', name: 'zsh' });
    });

    it('isolates terminals across scopes (chat A vs chat B in same project)', () => {
      const { addTerminal, getTerminals } = useTerminalStore.getState();
      addTerminal('chat-a', { id: 't1', name: 'zsh' });
      addTerminal('chat-b', { id: 't2', name: 'zsh' });
      expect(getTerminals('chat-a').map((t) => t.id)).toEqual(['t1']);
      expect(getTerminals('chat-b').map((t) => t.id)).toEqual(['t2']);
    });
  });

  describe('addTerminal', () => {
    it('caps tabs per scope at 3, dropping the oldest', () => {
      const { addTerminal, getTerminals } = useTerminalStore.getState();
      addTerminal('s', { id: '1', name: 'a' });
      addTerminal('s', { id: '2', name: 'b' });
      addTerminal('s', { id: '3', name: 'c' });
      addTerminal('s', { id: '4', name: 'd' });
      expect(getTerminals('s').map((t) => t.id)).toEqual(['2', '3', '4']);
    });

    it('sets the new tab as active', () => {
      const { addTerminal, getActiveTerminalId } = useTerminalStore.getState();
      addTerminal('s', { id: 't1', name: 'zsh' });
      expect(getActiveTerminalId('s')).toBe('t1');
    });
  });

  describe('removeTerminal', () => {
    it('promotes the last remaining tab when active is removed', () => {
      const { addTerminal, removeTerminal, getActiveTerminalId } = useTerminalStore.getState();
      addTerminal('s', { id: '1', name: 'a' });
      addTerminal('s', { id: '2', name: 'b' });
      removeTerminal('s', '2');
      expect(getActiveTerminalId('s')).toBe('1');
    });

    it('sets active to null when the last tab is removed', () => {
      const { addTerminal, removeTerminal, getActiveTerminalId } = useTerminalStore.getState();
      addTerminal('s', { id: '1', name: 'a' });
      removeTerminal('s', '1');
      expect(getActiveTerminalId('s')).toBeNull();
    });
  });

  describe('clearScope', () => {
    it('removes all terminals and active state for a scope', () => {
      const { addTerminal, clearScope, getTerminals, getActiveTerminalId } = useTerminalStore.getState();
      addTerminal('s', { id: '1', name: 'a' });
      addTerminal('s', { id: '2', name: 'b' });
      clearScope('s');
      expect(getTerminals('s')).toHaveLength(0);
      expect(getActiveTerminalId('s')).toBeNull();
    });
  });
});
