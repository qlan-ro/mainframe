import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { clearTerminalFocus } from './terminal-focus';

export interface CachedTerminal {
  wrapper: HTMLDivElement;
  term: Terminal;
  fitAddon: FitAddon;
  /** Disposables to run on disposeCachedTerminal — xterm listeners + PTY handle teardown. */
  disposers: Array<() => void>;
}

// Module-level cache: xterm instances survive component unmount so output is
// preserved across tab/session switches. Entries are removed only by
// disposeCachedTerminal() (tab close / pane close / Run toggle-off).
const cache = new Map<string, CachedTerminal>();

const lightAnsi = {
  black: '#252529',
  red: '#902d37',
  green: '#135834',
  yellow: '#684a00',
  blue: '#174685',
  magenta: '#6e347c',
  cyan: '#135356',
  white: '#424249',
  brightBlack: '#67676c',
  brightRed: '#c70016',
  brightGreen: '#1d7a46',
  brightYellow: '#826000',
  brightBlue: '#0063cc',
  brightMagenta: '#9a408a',
  brightCyan: '#06747b',
  brightWhite: '#727278',
};

const darkAnsi = {
  black: '#85858d',
  red: '#dd7076',
  green: '#4cc38a',
  yellow: '#c8a659',
  blue: '#78a8ea',
  magenta: '#c28bda',
  cyan: '#58b9c3',
  white: '#c7c7cc',
  brightBlack: '#a3a3ab',
  brightRed: '#ff8a80',
  brightGreen: '#7ee787',
  brightYellow: '#f4ce76',
  brightBlue: '#a3ceff',
  brightMagenta: '#eca8f3',
  brightCyan: '#93e2e8',
  brightWhite: '#f4f4f5',
};

function readTerminalTheme(root: HTMLElement): ITheme {
  const dark = root.classList.contains('dark');
  const style = getComputedStyle(root);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const background = color('--background', dark ? '#171717' : '#ffffff');
  const foreground = color('--ink-secondary', dark ? '#c7c7cc' : '#48484a');
  const scrollbarInk = color('--foreground', dark ? '#ececec' : '#1f1f1f');
  const ansi = dark ? darkAnsi : lightAnsi;
  return {
    ...ansi,
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    brightRed: color('--mf-tr-term-err', ansi.brightRed),
    brightGreen: color('--mf-tr-term-ok', ansi.brightGreen),
    selectionBackground: color('--text-selection', dark ? '#0a84ff6b' : '#0a84ff42'),
    scrollbarSliderBackground: `${scrollbarInk}42`,
    scrollbarSliderHoverBackground: `${scrollbarInk}6b`,
    scrollbarSliderActiveBackground: `${scrollbarInk}6b`,
    overviewRulerBorder: '#00000000',
  };
}

let themeObserver: MutationObserver | undefined;

function watchTerminalTheme(root: HTMLElement): void {
  if (themeObserver) return;
  let dark = root.classList.contains('dark');
  themeObserver = new MutationObserver(() => {
    const nextDark = root.classList.contains('dark');
    if (nextDark === dark) return;
    dark = nextDark;
    const theme = readTerminalTheme(root);
    for (const { term } of cache.values()) term.options.theme = theme;
  });
  themeObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
}

const FONT_SIZE = 12;
const FONT_FAMILY = "ui-monospace, 'SF Mono', Menlo, monospace";

function terminalLineHeight(): number {
  const context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  if (!context) return 19 / 14;
  context.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  const metrics = context.measureText('W');
  const height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
  return 19.001 / (height || 14);
}

/** Build (or return the cached) xterm for `id`, opened into a detached wrapper. */
export function getOrCreate(id: string): CachedTerminal {
  const existing = cache.get(id);
  if (existing) return existing;

  const root = document.documentElement;
  const wrapper = document.createElement('div');
  wrapper.className = 'h-full w-full';

  const term = new Terminal({
    cursorBlink: true,
    // The lane FitAddon leaves for the overlay thumb and its inset.
    overviewRuler: { width: 10 },
    fontSize: FONT_SIZE,
    fontFamily: FONT_FAMILY,
    lineHeight: terminalLineHeight(),
    minimumContrastRatio: 4.5,
    theme: readTerminalTheme(root),
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(wrapper);

  const entry: CachedTerminal = { wrapper, term, fitAddon, disposers: [] };
  cache.set(id, entry);
  watchTerminalTheme(root);
  return entry;
}

/** Read-only accessor (used by create-terminal + tests). */
export function getCachedTerminal(id: string): CachedTerminal | undefined {
  return cache.get(id);
}

/** Permanently destroy a cached terminal. Call on tab close — never on unmount. */
export function disposeCachedTerminal(id: string): void {
  const entry = cache.get(id);
  if (!entry) return;
  for (const d of entry.disposers) {
    try {
      d();
    } catch (err) {
      console.warn('[terminal-cache] disposer failed', err);
    }
  }
  entry.term.dispose();
  entry.wrapper.remove();
  cache.delete(id);
  if (!cache.size) {
    themeObserver?.disconnect();
    themeObserver = undefined;
  }
  clearTerminalFocus(id);
}
