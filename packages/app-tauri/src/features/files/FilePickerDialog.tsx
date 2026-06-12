/**
 * FilePickerDialog — VS Code Cmd+P style file-open command palette.
 *
 * Subscribes to `useFilesStore.pickerOpen`; the intent subscriber sets that
 * flag to true on `open-file-picker`. The dialog never reads the intent bus
 * directly — all state flows through the store.
 *
 * On selection, emits `emitSurfaceIntent({ type: 'open-file', path })` and
 * closes. The intent subscriber then opens the file tab in the Files surface.
 *
 * Mounted once at the app root (AppShell) alongside ArchiveWorktreeDialog.
 * Port and project context come from DaemonPortContext + useActiveIdentity.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { FileIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { searchFiles, type FileResult } from '@/lib/api/files';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useFilesStore } from '@/store/files';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';

// ---------------------------------------------------------------------------
// Debounce hook — avoids hitting the daemon on every keystroke
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ---------------------------------------------------------------------------
// useListNavigation — arrow-key + Enter navigation over a flat result list.
// Active index resets to 0 whenever `count` changes (new results).
// Returns the active index and a key-down handler for the input element.
// ---------------------------------------------------------------------------

function useListNavigation(count: number, onConfirm: (index: number) => void) {
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset to top whenever the result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [count]);

  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = Math.min(i + 1, count - 1);
          rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = Math.max(i - 1, 0);
          rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (count > 0) onConfirm(activeIndex);
      }
    },
    [count, activeIndex, onConfirm],
  );

  return { activeIndex, handleKeyDown, rowRefs };
}

// ---------------------------------------------------------------------------
// Result row
// ---------------------------------------------------------------------------

function FileRow({
  result,
  isActive,
  rowRef,
  onSelect,
}: {
  result: FileResult;
  isActive: boolean;
  rowRef: (el: HTMLButtonElement | null) => void;
  onSelect: (path: string) => void;
}) {
  const dir = result.path.includes('/') ? result.path.slice(0, result.path.lastIndexOf('/')) : '.';
  const activeClasses = isActive ? 'bg-accent text-accent-foreground' : '';
  return (
    <button
      ref={rowRef}
      type="button"
      role="option"
      aria-selected={isActive}
      data-active={isActive ? 'true' : 'false'}
      data-testid={`file-picker-row-${result.path}`}
      onClick={() => onSelect(result.path)}
      className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground ${activeClasses}`}
    >
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-body font-medium truncate">{result.name}</span>
      <span className="text-caption text-muted-foreground truncate ml-auto">{dir}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inner dialog body — only rendered when open (avoids stale search state)
// ---------------------------------------------------------------------------

function PickerBody({
  port,
  projectId,
  chatId,
  onClose,
}: {
  port: number;
  projectId: string;
  chatId: string | undefined;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileResult[]>([]);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 150);

  // Autofocus on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Trigger search when debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    let cancelled = false;
    searchFiles(port, projectId, debouncedQuery, chatId)
      .then((res) => {
        if (!cancelled) {
          setResults(res);
          setSearched(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('[file-picker] searchFiles error', err);
          setResults([]);
          setSearched(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, port, projectId, chatId]);

  const handleSelect = useCallback(
    (path: string) => {
      emitSurfaceIntent({ type: 'open-file', path });
      onClose();
    },
    [onClose],
  );

  const handleConfirm = useCallback(
    (index: number) => {
      const result = results[index];
      if (result) handleSelect(result.path);
    },
    [results, handleSelect],
  );

  const { activeIndex, handleKeyDown, rowRefs } = useListNavigation(results.length, handleConfirm);

  const showHint = !debouncedQuery.trim();
  const showEmpty = debouncedQuery.trim().length > 0 && searched && results.length === 0;

  return (
    <div data-testid="file-picker-dialog" className="flex flex-col overflow-hidden">
      <div className="flex items-center border-b border-border px-3">
        <input
          ref={inputRef}
          data-testid="file-picker-input"
          type="text"
          placeholder="Type to search files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex h-10 w-full bg-transparent py-3 text-body outline-none placeholder:text-muted-foreground"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div role="listbox" className="max-h-80 overflow-y-auto overflow-x-hidden p-1">
        {showHint && <p className="py-6 text-center text-body text-muted-foreground">Type to search files</p>}
        {showEmpty && <p className="py-6 text-center text-body text-muted-foreground">No matching files</p>}
        {results.map((r, i) => (
          <FileRow
            key={r.path}
            result={r}
            isActive={i === activeIndex}
            rowRef={(el) => {
              rowRefs.current[i] = el;
            }}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export — mounts once at the app root
// ---------------------------------------------------------------------------

export function FilePickerDialog() {
  const open = useFilesStore((s) => s.pickerOpen);
  const setPickerOpen = useFilesStore((s) => s.setPickerOpen);
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();

  const handleClose = useCallback(() => setPickerOpen(false), [setPickerOpen]);

  if (!open) return null;

  return (
    <Dialog open onOpenChange={handleClose}>
      <DialogContent className="overflow-hidden p-0 gap-0 max-w-xl" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Open file</DialogTitle>
        {projectId != null ? (
          <PickerBody port={port} projectId={projectId} chatId={chatId} onClose={handleClose} />
        ) : (
          <div data-testid="file-picker-dialog" className="py-6 text-center text-body text-muted-foreground">
            No project selected
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
