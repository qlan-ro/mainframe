/**
 * ConsolePane — scrollable log output pane for a single launch process.
 *
 * Reads `logsOutput` from the sandbox store, filters to the active scope +
 * process name via `selectLogs`, and renders each line with stream-aware
 * color coding (stdout = default, stderr = text-destructive). Auto-scrolls
 * on new output. A draggable-height handle lets the user resize the pane.
 */
import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useSandboxStore } from '@/store/sandbox';
import { selectLogs } from './select-logs';
import { Button } from '@/components/ui/button';

interface ConsolePaneProps {
  /** Scope key = `buildLaunchScope(projectId, effectivePath)`. */
  scopeKey: string;
  /** Name of the active launch config / process. */
  processName: string;
}

const MIN_HEIGHT = 80;
const DEFAULT_HEIGHT = 180;

export function ConsolePane({ scopeKey, processName }: ConsolePaneProps) {
  const logsOutput = useSandboxStore((s) => s.logsOutput);
  const clearLogsForProcess = useSandboxStore((s) => s.clearLogsForProcess);
  const entries = selectLogs(logsOutput, scopeKey, processName);

  const scrollRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(DEFAULT_HEIGHT);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(DEFAULT_HEIGHT);

  // Auto-scroll to the bottom whenever new entries arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  function onDragHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = heightRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onDragHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const delta = startYRef.current - e.clientY;
    const next = Math.max(MIN_HEIGHT, startHeightRef.current + delta);
    heightRef.current = next;
    if (containerRef.current) containerRef.current.style.height = `${next}px`;
  }

  function onDragHandlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      data-testid="run-console-pane"
      ref={containerRef}
      className="flex flex-col border-t border-border bg-card"
      style={{ height: DEFAULT_HEIGHT }}
    >
      {/* Drag handle */}
      <div
        data-testid="run-console-drag-handle"
        className="h-1 flex-shrink-0 cursor-ns-resize bg-border/50 hover:bg-border"
        onPointerDown={onDragHandlePointerDown}
        onPointerMove={onDragHandlePointerMove}
        onPointerUp={onDragHandlePointerUp}
      />

      {/* Toolbar */}
      <div className="flex h-7 flex-shrink-0 items-center justify-between border-b border-border px-2">
        <span className="text-caption text-muted-foreground">Console — {processName}</span>
        <Button
          data-testid="run-console-clear"
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          aria-label="Clear console"
          onClick={() => clearLogsForProcess(scopeKey, processName)}
        >
          <Trash2 size={10} />
        </Button>
      </div>

      {/* Log lines */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-caption leading-4"
      >
        {entries.length === 0 ? (
          <span className="text-muted-foreground">No output yet.</span>
        ) : (
          entries.map((entry, i) => (
            <div
              key={i}
              data-stream={entry.stream}
              className={entry.stream === 'stderr' ? 'text-destructive' : 'text-foreground'}
            >
              {entry.data}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
