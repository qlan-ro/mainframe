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

    // ResizeObserver for auto-fit
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          /* container not visible */
        }
      }
    });
    observer.observe(containerRef.current);

    return () => {
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
      // Delay fit to next frame so the DOM has the correct dimensions
      const frame = requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          /* not ready */
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [visible]);

  return <div ref={containerRef} className="absolute inset-0" style={{ visibility: visible ? 'visible' : 'hidden' }} />;
}
