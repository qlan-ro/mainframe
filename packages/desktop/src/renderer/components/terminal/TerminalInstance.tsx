import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalInstanceProps {
  terminalId: string;
  visible: boolean;
}

export function TerminalInstance({ terminalId, visible }: TerminalInstanceProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
      theme: {
        background: getComputedStyle(document.documentElement).getPropertyValue('--mf-input-bg').trim() || '#1e1e2e',
        foreground:
          getComputedStyle(document.documentElement).getPropertyValue('--mf-text-primary').trim() || '#cdd6f4',
        cursor: getComputedStyle(document.documentElement).getPropertyValue('--mf-accent').trim() || '#fab387',
        selectionBackground: '#585b7066',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Wire keystrokes → PTY
    const onDataDisposable = term.onData((data) => {
      window.mainframe.terminal.write(terminalId, data);
    });

    // Wire PTY output → xterm
    const handleData = (id: string, data: string): void => {
      if (id === terminalId) {
        term.write(data);
      }
    };
    const removeDataListener = window.mainframe.terminal.onData(handleData);

    // Handle resize
    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      window.mainframe.terminal.resize(terminalId, cols, rows);
    });

    // ResizeObserver for auto-fit — debounced with trailing delay to prevent
    // rapid-fire PTY resize calls during drag. Each fit() resizes xterm AND
    // sends cols/rows to the PTY via IPC; flooding the PTY at 60Hz causes
    // cols mismatch when the shell emits output between resize calls.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const RESIZE_DEBOUNCE_MS = 150;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !fitAddonRef.current) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return; // container hidden or collapsed
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          /* container transitioning — fit will be retried on next resize */
        }
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(containerRef.current);

    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      removeDataListener();
      term.dispose();
      termRef.current = null;
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
