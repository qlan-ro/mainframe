// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import type { ITerminalOptions } from '@xterm/xterm';
import { describe, expect, it, beforeEach, vi } from 'vitest';

// xterm touches canvas/DOM; mock it so the cache logic is testable in jsdom.
const writeSpy = vi.fn();
const disposeSpy = vi.fn();
const loadAddonSpy = vi.fn();
const openSpy = vi.fn();

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(public options: ITerminalOptions) {}
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

import { contrast, parseRules, resolveOklch, toRgba } from '@/styles/__tests__/css-color';
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

  it('updates mounted and detached terminals in place when the root theme changes', async () => {
    const root = document.documentElement;
    root.classList.remove('dark');
    const mounted = getOrCreate('theme-mounted');
    const detached = getOrCreate('theme-detached');
    document.body.append(mounted.wrapper);
    const light = mounted.term.options.theme;
    openSpy.mockClear();
    try {
      root.classList.add('dark');
      await Promise.resolve();

      expect(light?.background).toBe('#ffffff');
      expect(mounted.term.options.theme?.background).toBe('#171717');
      expect(detached.term.options.theme).toEqual(mounted.term.options.theme);
      expect(getCachedTerminal('theme-mounted')?.term).toBe(mounted.term);
      expect(openSpy).not.toHaveBeenCalled();
      expect(disposeSpy).not.toHaveBeenCalled();
    } finally {
      disposeCachedTerminal('theme-mounted');
      disposeCachedTerminal('theme-detached');
      root.classList.remove('dark');
    }
  });

  it.each(['light', 'dark'] as const)('has sixteen readable ANSI colours in %s', (mode) => {
    const root = document.documentElement;
    const dark = mode === 'dark';
    const tokens = Object.assign(
      {},
      ...['../../../styles/globals.css', '../../../styles/domain-tokens.css', '../../chat/transcript.css'].map(
        (file) => {
          const rules = parseRules(readFileSync(new URL(file, import.meta.url), 'utf8'));
          return { ...rules.get(':root'), ...(dark && rules.get('.dark')) };
        },
      ),
    );
    const resolveToken = (name: string): string => {
      const value = tokens[name] as string;
      const reference = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
      return reference ? resolveToken(reference) : value;
    };
    root.classList.toggle('dark', dark);
    const themeTokens = ['--background', '--mf-tr-term-err', '--mf-tr-term-ok'];
    for (const name of themeTokens) root.style.setProperty(name, resolveToken(name));

    try {
      const { term } = getOrCreate('ansi-contrast');
      const theme = term.options.theme!;
      const rgb = (value: string) => toRgba(resolveOklch(value, resolveToken));
      const background = rgb(theme.background!);
      const normal = [
        theme.black,
        theme.red,
        theme.green,
        theme.yellow,
        theme.blue,
        theme.magenta,
        theme.cyan,
        theme.white,
      ];
      const bright = [
        theme.brightBlack,
        theme.brightRed,
        theme.brightGreen,
        theme.brightYellow,
        theme.brightBlue,
        theme.brightMagenta,
        theme.brightCyan,
        theme.brightWhite,
      ];
      expect(new Set([...normal, ...bright]).size).toBe(16);
      for (const ansi of [...normal, ...bright]) {
        expect(ansi).toMatch(/^#[\da-f]{6}$/i);
        expect(contrast(rgb(ansi!), background), ansi).toBeGreaterThanOrEqual(4.5);
      }
      expect(term.options.minimumContrastRatio).toBe(4.5);
    } finally {
      disposeCachedTerminal('ansi-contrast');
      for (const name of themeTokens) root.style.removeProperty(name);
      root.classList.remove('dark');
    }
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
