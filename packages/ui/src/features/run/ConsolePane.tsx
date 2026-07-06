/**
 * ConsolePane — scrollable log output for a single launch process.
 *
 * Reads `logsOutput` from the sandbox store, filters to the active scope +
 * process name via `selectLogs`, and renders each line with stream-aware color
 * coding (stdout = default, stderr = text-destructive). Auto-scrolls on new
 * output.
 *
 * Two variants:
 *  - `full` (default) — fills its parent; the body of a console-process tab.
 *  - `drawer` — a collapsible bottom drawer (collapsed by default) that shows the
 *    last line as a tail; used beneath a preview webview.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useSandboxStore, type LogEntry } from '@/store/sandbox';
import { selectLogs } from './select-logs';
import { Button } from '@/components/ui/button';

const DRAWER_DEFAULT_H = 150;
const DRAWER_MIN_H = 60;

/** Drag-to-resize state for the drawer's log area. Dragging up grows it. */
function useDrawerResize(initial: number) {
  const [height, setHeight] = useState(initial);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;
      // Capture so the drag keeps tracking when the pointer leaves the thin
      // handle. Guard for envs without Pointer Capture (jsdom) — the move handler
      // still drives the resize there.
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* expected: no Pointer Capture support (test env) */
      }
    },
    [height],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    setHeight(Math.max(DRAWER_MIN_H, startH.current + (startY.current - e.clientY)));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* expected: no Pointer Capture support (test env) */
    }
  }, []);

  return { height, onPointerDown, onPointerMove, onPointerUp };
}

function DrawerResizeHandle(props: {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      data-testid="run-console-resize"
      role="separator"
      aria-orientation="horizontal"
      className="group flex h-[6px] flex-shrink-0 cursor-row-resize touch-none items-center"
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
    >
      <div className="h-px w-full bg-border transition-colors group-hover:bg-mf-text-3 group-active:bg-primary" />
    </div>
  );
}

interface ConsolePaneProps {
  /** Scope key = `buildLaunchScope(projectId, effectivePath)`. */
  scopeKey: string;
  /** Name of the active launch config / process. */
  processName: string;
  /** `full` (default) fills the parent; `drawer` is a collapsible bottom drawer. */
  variant?: 'full' | 'drawer';
}

function LogLines({ entries, scrollRef }: { entries: LogEntry[]; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto pl-[12px] pr-[12px] pt-0 pb-[10px] font-mono text-caption leading-relaxed"
    >
      {entries.length === 0 ? (
        <span className="text-muted-foreground">No output yet.</span>
      ) : (
        entries.map((entry) => (
          <div
            key={entry.seq}
            data-stream={entry.stream}
            className={entry.stream === 'stderr' ? 'text-destructive' : 'text-foreground'}
          >
            {entry.data}
          </div>
        ))
      )}
    </div>
  );
}

function LogCountChip({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="flex-shrink-0 rounded-md bg-mf-chip px-[6px] py-[1px] font-mono text-micro text-mf-text-4">
      {count} logs
    </span>
  );
}

function ClearButton({ onClear }: { onClear: () => void }) {
  return (
    <Button
      data-testid="run-console-clear"
      variant="ghost"
      size="icon"
      className="h-5 w-5"
      aria-label="Clear console"
      onClick={onClear}
    >
      <Trash2 size={10} />
    </Button>
  );
}

export function ConsolePane({ scopeKey, processName, variant = 'full' }: ConsolePaneProps) {
  const logsOutput = useSandboxStore((s) => s.logsOutput);
  const clearLogsForProcess = useSandboxStore((s) => s.clearLogsForProcess);
  const entries = selectLogs(logsOutput, scopeKey, processName);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const { height, onPointerDown, onPointerMove, onPointerUp } = useDrawerResize(DRAWER_DEFAULT_H);

  // Auto-scroll to the bottom whenever new entries arrive (when the body is shown).
  const showBody = variant === 'full' || expanded;
  useEffect(() => {
    if (!showBody) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, showBody, height]);

  const onClear = () => clearLogsForProcess(scopeKey, processName);

  if (variant === 'drawer') {
    const tail = entries.length > 0 ? entries[entries.length - 1]!.data : 'No output yet.';
    return (
      <div data-testid="run-console-drawer" className="flex flex-shrink-0 flex-col bg-card">
        {expanded && (
          <DrawerResizeHandle onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
        )}
        <div
          className={`flex h-[28px] flex-shrink-0 items-center gap-[8px] pl-[12px] pr-[8px] ${expanded ? '' : '[border-top:0.5px_solid_var(--border)]'}`}
        >
          <button
            data-testid="run-console-drawer-toggle"
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-[8px] text-left"
          >
            <ChevronDown
              size={11}
              className={`flex-shrink-0 text-muted-foreground transition-transform ${expanded ? '' : '-rotate-90'}`}
            />
            <span className="flex-shrink-0 text-caption font-semibold text-muted-foreground">Console</span>
            <LogCountChip count={entries.length} />
            {!expanded && <span className="min-w-0 flex-1 truncate font-mono text-micro text-mf-text-4">{tail}</span>}
          </button>
          <span className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <ClearButton onClear={onClear} />
          </span>
        </div>
        {expanded && (
          <div
            data-testid="run-console-log-area"
            style={{ height }}
            className="flex flex-col [border-top:0.5px_solid_var(--border)]"
          >
            <LogLines entries={entries} scrollRef={scrollRef} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="run-console-pane" className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-[28px] flex-shrink-0 items-center justify-between [border-bottom:0.5px_solid_var(--border)] pl-[12px] pr-[6px]">
        <div className="flex min-w-0 items-center gap-[8px]">
          <span className="flex-shrink-0 text-caption font-semibold text-muted-foreground">Console</span>
          <LogCountChip count={entries.length} />
        </div>
        <ClearButton onClear={onClear} />
      </div>
      <LogLines entries={entries} scrollRef={scrollRef} />
    </div>
  );
}
