/**
 * FindInPathModal — scoped content search dialog.
 *
 * Opened via useOverlaysStore.findInPath (set by the intent subscriber on
 * 'open-find-in-path'). Searches within a file or directory scope using the
 * daemon's searchContent endpoint. Emits 'open-file' with { path, line,
 * character } so the editor can reveal the exact match location.
 *
 * Borrows useDebounce + useListNavigation from use-file-search. Does NOT
 * reuse FileRow (wrong shape + wrong testid prefix for content results).
 */
import { useEffect, useRef, useState } from 'react';
import type { SearchContentResult } from '@qlan-ro/mainframe-types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useOverlaysStore } from '@/store/overlays';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { searchContent } from '@/lib/api/files';
import { useDebounce, useListNavigation } from '@/features/files/use-file-search';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';

// ---------------------------------------------------------------------------
// Result list — bespoke rows for SearchContentResult hits
// ---------------------------------------------------------------------------

interface ResultRowProps {
  result: SearchContentResult;
  isActive: boolean;
  rowRef: (el: HTMLButtonElement | null) => void;
  onSelect: (result: SearchContentResult) => void;
}

function ResultRow({ result, isActive, rowRef, onSelect }: ResultRowProps) {
  const activeClasses = isActive ? 'bg-accent text-accent-foreground' : '';
  return (
    <button
      ref={rowRef}
      type="button"
      role="option"
      aria-selected={isActive}
      data-active={isActive ? 'true' : 'false'}
      data-testid={`find-in-path-result-${result.file}:${result.line}:${result.column}`}
      onClick={() => onSelect(result)}
      className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground ${activeClasses}`}
    >
      <span className="text-caption tabular-nums text-muted-foreground shrink-0 w-10 text-right">{result.line}</span>
      <span className="truncate text-body font-mono">{result.text}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Grouped result list — sticky file header + per-hit rows
// ---------------------------------------------------------------------------

interface GroupedResultsProps {
  results: SearchContentResult[];
  activeIndex: number;
  rowRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  onSelect: (result: SearchContentResult) => void;
}

function GroupedResults({ results, activeIndex, rowRefs, onSelect }: GroupedResultsProps) {
  // Group results by file, preserving their flat indices for keyboard nav
  type GroupEntry = { file: string; items: Array<{ result: SearchContentResult; index: number }> };
  const groups: GroupEntry[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result) continue;
    const last = groups[groups.length - 1];
    if (last && last.file === result.file) {
      last.items.push({ result, index: i });
    } else {
      groups.push({ file: result.file, items: [{ result, index: i }] });
    }
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.file} role="group" aria-label={group.file}>
          <div className="sticky top-0 bg-popover px-3 py-1 text-caption font-semibold text-muted-foreground truncate border-b border-border">
            {group.file}
          </div>
          {group.items.map(({ result, index }) => (
            <ResultRow
              key={`${result.file}:${result.line}:${result.column}`}
              result={result}
              isActive={activeIndex === index}
              rowRef={(el) => {
                rowRefs.current[index] = el;
              }}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FindInPathModal() {
  const scope = useOverlaysStore((s) => s.findInPath);
  const setFindInPath = useOverlaysStore((s) => s.setFindInPath);

  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();

  const [query, setQuery] = useState('');
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [results, setResults] = useState<SearchContentResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounce(query, 300);

  const reqIdRef = useRef(0);

  // Reset state when scope changes (new open or close).
  // Bump reqIdRef so any in-flight searchContent cannot land after reset.
  useEffect(() => {
    if (scope == null) {
      reqIdRef.current++;
      setQuery('');
      setResults([]);
      setError(null);
    }
  }, [scope]);

  // Fetch results on debounced query change
  useEffect(() => {
    if (scope == null || !projectId || debounced.trim().length < 2) {
      // Invalidate any in-flight request so a late response cannot land.
      reqIdRef.current++;
      setResults([]);
      setError(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    searchContent(port, projectId, debounced, scope.scopePath, {
      includeIgnored: scope.scopeType === 'directory' ? includeIgnored : undefined,
      chatId,
    })
      .then((r) => {
        if (reqId === reqIdRef.current) {
          setResults(r);
          setError(null);
        }
      })
      .catch((err) => {
        if (reqId === reqIdRef.current) {
          console.warn('[find-in-path] searchContent failed', err);
          setResults([]);
          setError('Search failed. Please try again.');
        }
      });
  }, [port, projectId, chatId, debounced, scope, includeIgnored]);

  function handleSelect(result: SearchContentResult) {
    emitSurfaceIntent({
      type: 'open-file',
      path: result.file,
      line: result.line,
      character: result.column,
    });
    setFindInPath(null);
  }

  const { activeIndex, handleKeyDown, rowRefs } = useListNavigation(results.length, (idx) => {
    const result = results[idx];
    if (result) handleSelect(result);
  });

  const showHint = query.trim().length === 1;
  const showEmpty = debounced.trim().length >= 2 && results.length === 0 && error == null;

  return (
    <Dialog
      open={scope != null}
      onOpenChange={(o) => {
        if (!o) setFindInPath(null);
      }}
    >
      <DialogContent className="max-w-2xl p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-body">
            {scope?.scopeType === 'file' ? `Find in file: ${scope.scopePath}` : `Find in: ${scope?.scopePath ?? ''}`}
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-3 flex items-center gap-3 border-b border-border">
          <input
            autoFocus
            type="text"
            data-testid="find-in-path-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search..."
            className="flex-1 bg-transparent outline-none text-body placeholder:text-muted-foreground"
          />
          {scope?.scopeType === 'directory' && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-caption text-muted-foreground shrink-0">
              <input
                type="checkbox"
                data-testid="find-in-path-include-ignored"
                checked={includeIgnored}
                onChange={(e) => setIncludeIgnored(e.target.checked)}
                className="rounded"
              />
              Include ignored
            </label>
          )}
        </div>

        <div role="listbox" aria-label="Search results" className="max-h-96 overflow-y-auto">
          {showHint && (
            <p className="px-4 py-6 text-center text-caption text-muted-foreground">
              Type at least 2 characters to search
            </p>
          )}
          {!showHint && query.trim().length === 0 && (
            <p className="px-4 py-6 text-center text-caption text-muted-foreground">Type to search</p>
          )}
          {error != null && <p className="px-4 py-4 text-center text-caption text-destructive">{error}</p>}
          {showEmpty && <p className="px-4 py-6 text-center text-caption text-muted-foreground">No matches</p>}
          {results.length > 0 && (
            <GroupedResults results={results} activeIndex={activeIndex} rowRefs={rowRefs} onSelect={handleSelect} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
