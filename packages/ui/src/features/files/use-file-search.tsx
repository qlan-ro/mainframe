import { useEffect, useRef, useState } from 'react';
import { FileIcon } from 'lucide-react';
import { searchFiles, type FileResult } from '@/lib/api/files';
export { useListNavigation } from '@/lib/ui/use-list-navigation';

/** Returns the directory portion of a relative path, or '.' for root-level files. */
export function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
}

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
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
  const dir = dirOf(result.path);
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
      className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-[12px] py-[8px] text-left outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground ${activeClasses}`}
    >
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-body font-medium truncate">{result.name}</span>
      <span className="text-label text-muted-foreground truncate ml-auto">{dir}</span>
    </button>
  );
}

/**
 * Debounced project file search. Returns [] for queries shorter than `minLength`
 * chars (default 2; FilePickerDialog passes 1 for single-keystroke search).
 */
export function useFileSearch(
  port: number,
  projectId: string | undefined,
  chatId: string | undefined,
  query = '',
  minLength = 2,
) {
  const debounced = useDebounce(query, 300);
  const [results, setResults] = useState<FileResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const reqIdRef = useRef(0);
  useEffect(() => {
    if (!projectId || debounced.trim().length < minLength) {
      // Invalidate any in-flight request so a late response cannot land.
      reqIdRef.current++;
      setResults([]);
      setSearched(false);
      setLoading(false);
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
  }, [port, projectId, chatId, debounced, minLength]);
  return { results, searched, loading };
}
