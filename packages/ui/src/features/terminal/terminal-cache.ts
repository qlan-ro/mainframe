import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

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

function tokenColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Build (or return the cached) xterm for `id`, opened into a detached wrapper. */
export function getOrCreate(id: string): CachedTerminal {
  const existing = cache.get(id);
  if (existing) return existing;

  const wrapper = document.createElement('div');
  wrapper.className = 'absolute inset-0';

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    theme: {
      // Use app-tauri purpose-built terminal tokens (--mf-term-*).
      // Desktop used --mf-input-bg / --mf-text-primary / --mf-accent which
      // do not exist in app-tauri CSS — remapped to the real token names.
      background: tokenColor('--mf-term-bg', '#1d1d20'),
      foreground: tokenColor('--mf-term-fg', '#e7e6e3'),
      cursor: tokenColor('--mf-term-amber', '#ff9f0a'),
      selectionBackground: '#585b7066',
    },
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(wrapper);

  const entry: CachedTerminal = { wrapper, term, fitAddon, disposers: [] };
  cache.set(id, entry);
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
}
