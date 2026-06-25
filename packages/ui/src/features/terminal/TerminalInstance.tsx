import { useEffect, useRef } from 'react';
import { getOrCreate } from './terminal-cache';

interface Props {
  terminalId: string;
  visible: boolean;
}

const RESIZE_DEBOUNCE_MS = 150;

export function TerminalInstance({ terminalId, visible }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const entry = getOrCreate(terminalId);
    fitRef.current = entry.fitAddon;
    container.appendChild(entry.wrapper);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const { width, height } = e.contentRect;
      if (width === 0 || height === 0) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          entry.fitAddon.fit();
        } catch {
          /* container transitioning — ResizeObserver retries on next resize */
        }
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      // Detach but DO NOT dispose — output is preserved across switches.
      if (entry.wrapper.parentNode === container) {
        container.removeChild(entry.wrapper);
      }
      fitRef.current = null;
    };
  }, [terminalId]);

  useEffect(() => {
    if (!visible || !fitRef.current) return;
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
        } catch {
          /* layout not ready — ResizeObserver retries */
        }
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return (
    <div
      ref={containerRef}
      data-testid={`run-terminal-${terminalId}`}
      className="absolute inset-0"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
    />
  );
}
