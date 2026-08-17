// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';

// xterm touches canvas/DOM; mock it so the cache logic is testable in jsdom.
const writeSpy = vi.fn();
const disposeSpy = vi.fn();
const loadAddonSpy = vi.fn();
const openSpy = vi.fn();

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = writeSpy;
    dispose = disposeSpy;
    loadAddon = loadAddonSpy;
    open = openSpy;
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { getOrCreate, disposeCachedTerminal, getCachedTerminal } from '../terminal-cache';
// Real module — verifying disposeCachedTerminal's effect on it is the point of these tests.
import { requestTerminalFocus, claimTerminalFocus } from '../terminal-focus';

describe('terminal-cache', () => {
  beforeEach(() => {
    writeSpy.mockClear();
    disposeSpy.mockClear();
  });

  it('getOrCreate returns the same entry for the same id', () => {
    const a = getOrCreate('t1');
    const b = getOrCreate('t1');
    expect(a).toBe(b);
    disposeCachedTerminal('t1');
  });

  it('getOrCreate opens the term into a detached wrapper', () => {
    const entry = getOrCreate('t2');
    expect(entry.wrapper).toBeInstanceOf(HTMLDivElement);
    expect(openSpy).toHaveBeenCalledWith(entry.wrapper);
    disposeCachedTerminal('t2');
  });

  it('disposeCachedTerminal removes the entry and disposes the term', () => {
    getOrCreate('t3');
    expect(getCachedTerminal('t3')).toBeDefined();
    disposeCachedTerminal('t3');
    expect(disposeSpy).toHaveBeenCalled();
    expect(getCachedTerminal('t3')).toBeUndefined();
  });

  it('a fresh getOrCreate after dispose builds a new entry', () => {
    const a = getOrCreate('t4');
    disposeCachedTerminal('t4');
    const b = getOrCreate('t4');
    expect(a).not.toBe(b);
    disposeCachedTerminal('t4');
  });

  it('disposeCachedTerminal clears a pending focus request for that id', () => {
    getOrCreate('t5');
    requestTerminalFocus('t5');
    disposeCachedTerminal('t5');
    expect(claimTerminalFocus('t5')).toBe(false);
  });

  it('disposeCachedTerminal leaves a pending request for a different id alone', () => {
    getOrCreate('t6');
    requestTerminalFocus('other-id');
    disposeCachedTerminal('t6');
    expect(claimTerminalFocus('other-id')).toBe(true);
  });
});
