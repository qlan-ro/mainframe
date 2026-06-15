import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FileIcon } from 'lucide-react';
import { searchFiles, type FileResult } from '@/lib/api/files';

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function useListNavigation(count: number, onConfirm: (index: number) => void) {
  const [activeIndex, setActiveIndex] = useState(0);
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

export function FileRow({
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

/** Debounced project file search. Returns [] for queries < 2 chars. */
export function useFileSearch(port: number, projectId: string | undefined, chatId: string | undefined, query = '') {
  const debounced = useDebounce(query, 300);
  const [results, setResults] = useState<FileResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const reqIdRef = useRef(0);
  useEffect(() => {
    if (!projectId || debounced.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    searchFiles(port, projectId, debounced, chatId)
      .then((r) => {
        if (reqId === reqIdRef.current) {
          setResults(r);
          setSearched(true);
        }
      })
      .catch((err) => {
        if (reqId === reqIdRef.current) {
          console.warn('[use-file-search] searchFiles failed', err);
          setResults([]);
          setSearched(true);
        }
      })
      .finally(() => {
        if (reqId === reqIdRef.current) setLoading(false);
      });
  }, [port, projectId, chatId, debounced]);
  return { results, searched, loading };
}
