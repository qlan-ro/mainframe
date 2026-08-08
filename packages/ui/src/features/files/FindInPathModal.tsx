/**
 * Scoped content search dialog, on the stock cmdk engine.
 *
 * Opened via useOverlaysStore.findInPath (set by the intent subscriber on
 * 'open-find-in-path'). The daemon's searchContent does the matching, so cmdk
 * runs with `shouldFilter={false}` and contributes the input, listbox
 * semantics and keyboard navigation. One CommandGroup per file replaces the
 * v1 hand-grouped list. Emits 'open-file' with { path, line, character } so
 * the editor reveals the exact match.
 */
import { useEffect, useRef, useState } from 'react';
import type { SearchContentResult } from '@qlan-ro/mainframe-types';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useOverlaysStore } from '@/store/overlays';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { searchContent } from '@/lib/api/files';
import { useDebounce } from '@/features/files/use-file-search';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';

type FileGroup = { file: string; results: SearchContentResult[] };

function groupByFile(results: SearchContentResult[]): FileGroup[] {
  const groups: FileGroup[] = [];
  for (const result of results) {
    const last = groups[groups.length - 1];
    if (last && last.file === result.file) last.results.push(result);
    else groups.push({ file: result.file, results: [result] });
  }
  return groups;
}

export function FindInPathModal() {
  const scope = useOverlaysStore((s) => s.findInPath);
  const setFindInPath = useOverlaysStore((s) => s.setFindInPath);

  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();

  const [query, setQuery] = useState('');
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [results, setResults] = useState<SearchContentResult[]>([]);
  const [selected, setSelected] = useState('');
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
    // result.line/result.column are 1-based (daemon search.ts). The
    // open-file intent's RevealTarget contract is 0-based (store/editor.ts).
    emitSurfaceIntent({
      type: 'open-file',
      path: result.file,
      line: result.line - 1,
      character: result.column - 1,
    });
    setFindInPath(null);
  }

  // Controlled selection: results land async, after cmdk's own
  // select-first-on-search tick (see FilePickerDialog).
  useEffect(() => {
    const keys = results.map((r) => `${r.file}:${r.line}:${r.column}`);
    if (keys.length > 0 && !keys.includes(selected)) setSelected(keys[0]!);
  }, [results, selected]);

  const showHint = query.trim().length === 1;
  const showIdle = query.trim().length === 0;
  const showEmpty = debounced.trim().length >= 2 && results.length === 0 && error == null && !showHint && !showIdle;

  return (
    <Dialog
      open={scope != null}
      onOpenChange={(o) => {
        if (!o) setFindInPath(null);
      }}
    >
      <DialogContent data-testid="find-in-path" showCloseButton={false} className="gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-4 py-3">
          <DialogTitle className="min-w-0 truncate text-sm">
            {scope?.scopeType === 'file' ? `Find in file: ${scope.scopePath}` : `Find in: ${scope?.scopePath ?? ''}`}
          </DialogTitle>
          {scope?.scopeType === 'directory' && (
            <div className="flex shrink-0 items-center gap-1.5">
              <Checkbox
                id="find-in-path-include-ignored"
                data-testid="find-in-path-include-ignored"
                checked={includeIgnored}
                onCheckedChange={(value) => setIncludeIgnored(value === true)}
              />
              <Label htmlFor="find-in-path-include-ignored" className="text-xs text-muted-foreground">
                Include ignored
              </Label>
            </div>
          )}
        </DialogHeader>

        <Command shouldFilter={false} value={selected} onValueChange={setSelected}>
          <CommandInput
            autoFocus
            data-testid="find-in-path-input"
            value={query}
            onValueChange={setQuery}
            placeholder="Search…"
          />
          {/* Bespoke states instead of CommandEmpty: cmdk's empty would also
              fire on the idle and one-character states, which say different
              things here. */}
          <CommandList aria-label="Search results" className="max-h-96">
            {showHint && (
              <p data-testid="find-in-path-hint" className="px-4 py-6 text-center text-xs text-muted-foreground">
                Type at least 2 characters to search
              </p>
            )}
            {showIdle && (
              <p data-testid="find-in-path-idle-hint" className="px-4 py-6 text-center text-xs text-muted-foreground">
                Type to search
              </p>
            )}
            {error != null && (
              <p data-testid="find-in-path-error" className="px-4 py-4 text-center text-xs text-destructive">
                {error}
              </p>
            )}
            {showEmpty && (
              <p data-testid="find-in-path-empty" className="px-4 py-6 text-center text-xs text-muted-foreground">
                No matches
              </p>
            )}
            {groupByFile(results).map((group) => (
              <CommandGroup key={group.file} heading={group.file}>
                {group.results.map((result) => (
                  <CommandItem
                    key={`${result.file}:${result.line}:${result.column}`}
                    value={`${result.file}:${result.line}:${result.column}`}
                    data-testid={`find-in-path-result-${result.file}:${result.line}:${result.column}`}
                    onSelect={() => handleSelect(result)}
                  >
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {result.line}
                    </span>
                    <span className="truncate font-mono">{result.text}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
