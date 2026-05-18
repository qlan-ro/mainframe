import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalInstanceProps {
  terminalId: string;
  visible: boolean;
}

interface CachedTerminal {
  wrapper: HTMLDivElement;
  term: Terminal;
  fitAddon: FitAddon;
  dispose: () => void;
}

// Module-level cache: xterm instances survive component unmount so output is
// preserved across project switches and panel minimize. Entries are removed
// only by disposeCachedTerminal() when the user closes a tab.
const cache = new Map<string, CachedTerminal>();

function getOrCreate(terminalId: string): CachedTerminal {
  const existing = cache.get(terminalId);
  if (existing) return existing;

  const wrapper = document.createElement('div');
  wrapper.className = 'absolute inset-0';

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    theme: {
      background: getComputedStyle(document.documentElement).getPropertyValue('--mf-input-bg').trim() || '#1e1e2e',
      foreground: getComputedStyle(document.documentElement).getPropertyValue('--mf-text-primary').trim() || '#cdd6f4',
      cursor: getComputedStyle(document.documentElement).getPropertyValue('--mf-accent').trim() || '#fab387',
      selectionBackground: '#585b7066',
    },
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(wrapper);

  const onDataDisposable = term.onData((data) => {
    window.mainframe.terminal.write(terminalId, data);
  });

  const handleData = (id: string, data: string): void => {
    if (id === terminalId) term.write(data);
  };
  const removeDataListener = window.mainframe.terminal.onData(handleData);

  const onResizeDisposable = term.onResize(({ cols, rows }) => {
    window.mainframe.terminal.resize(terminalId, cols, rows);
  });

  const dispose = (): void => {
    onDataDisposable.dispose();
    onResizeDisposable.dispose();
    removeDataListener();
    term.dispose();
    wrapper.remove();
  };

  const entry: CachedTerminal = { wrapper, term, fitAddon, dispose };
  cache.set(terminalId, entry);
  return entry;
}

/**
 * Permanently destroy a cached terminal. Call when the user closes a tab —
 * not on component unmount. After this returns, the terminalId can be
 * reused (a new wrapper/Terminal will be created on next getOrCreate).
 */
export function disposeCachedTerminal(terminalId: string): void {
  const entry = cache.get(terminalId);
  if (!entry) return;
  entry.dispose();
  cache.delete(terminalId);
}

export function TerminalInstance({ terminalId, visible }: TerminalInstanceProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const entry = getOrCreate(terminalId);
    fitAddonRef.current = entry.fitAddon;
    container.appendChild(entry.wrapper);

    // Debounced auto-fit. Each fit() resizes xterm AND sends cols/rows to the
    // PTY via IPC; flooding at 60Hz causes cols mismatch when the shell emits
    // output between resize calls.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const RESIZE_DEBOUNCE_MS = 150;
    const observer = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const { width, height } = e.contentRect;
      if (width === 0 || height === 0) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          entry.fitAddon.fit();
        } catch {
          /* container transitioning — fit will be retried on next resize */
        }
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);

    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
      // Detach wrapper from this container — keep the cached Terminal alive
      // so output is preserved across project switches and panel minimize.
      if (entry.wrapper.parentNode === container) {
        container.removeChild(entry.wrapper);
      }
      fitAddonRef.current = null;
    };
  }, [terminalId]);

  // Re-fit when visibility changes (tab switch)
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      // Double RAF ensures layout has fully settled after visibility change
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            fitAddonRef.current?.fit();
          } catch {
            /* layout not ready — ResizeObserver will retry on next resize */
          }
        });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [visible]);

  return <div ref={containerRef} className="absolute inset-0" style={{ visibility: visible ? 'visible' : 'hidden' }} />;
}
