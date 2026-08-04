/**
 * FilePickerDialog — VS Code Cmd+P style file-open palette, on the stock cmdk
 * engine (the same shape as SpotlightPalette and FindInPathModal).
 *
 * Subscribes to `useFilesStore.pickerOpen`; the intent subscriber sets that
 * flag to true on `open-file-picker`. The daemon does the matching
 * (useFileSearch), so cmdk runs with `shouldFilter={false}` and contributes
 * the input, listbox semantics and keyboard navigation.
 *
 * On selection, emits `emitSurfaceIntent({ type: 'open-file', path })` and
 * closes. Mounted once at the app root (AppShell).
 */
import { useCallback, useEffect, useState } from 'react';
import { Command, CommandInput, CommandItem, CommandList } from '@v2/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@v2/components/ui/dialog';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useFilesStore } from '@/store/files';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { fileIconFor } from '@/lib/editor/file-types';
import { dirOf, useFileSearch } from './use-file-search';

// ---------------------------------------------------------------------------
// Inner body — only rendered while open (avoids stale search state)
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

  // minLength=1: the picker searches on any non-empty keystroke (original behaviour).
  const { results, searched, loading } = useFileSearch(port, projectId, chatId, query, 1);

  // Controlled selection: results land ASYNC (debounced fetch), after cmdk's
  // own select-first-on-search tick — without this, a replaced result set
  // leaves nothing selected and Enter is a no-op.
  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (results.length > 0 && !results.some((r) => r.path === selected)) setSelected(results[0]!.path);
  }, [results, selected]);

  const handleSelect = useCallback(
    (path: string) => {
      emitSurfaceIntent({ type: 'open-file', path });
      onClose();
    },
    [onClose],
  );

  const showHint = !query.trim();
  const showEmpty = query.trim().length > 0 && searched && results.length === 0;

  return (
    <Command shouldFilter={false} value={selected} onValueChange={setSelected} data-testid="file-picker-dialog">
      <CommandInput
        autoFocus
        data-testid="file-picker-input"
        value={query}
        onValueChange={setQuery}
        placeholder="Type to search files…"
      />
      {/* Bespoke states instead of CommandEmpty: idle and loading say
          different things than "no matches". */}
      <CommandList className="max-h-80">
        {showHint && <p className="py-6 text-center text-muted-foreground">Type to search files</p>}
        {loading && !results.length && (
          <p data-testid="file-picker-loading" className="py-6 text-center text-muted-foreground">
            Searching…
          </p>
        )}
        {showEmpty && <p className="py-6 text-center text-muted-foreground">No matching files</p>}
        {results.map((result) => {
          const Icon = fileIconFor(result.name);
          return (
            <CommandItem
              key={result.path}
              value={result.path}
              data-testid={`file-picker-row-${result.path}`}
              onSelect={() => handleSelect(result.path)}
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{result.name}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">{dirOf(result.path)}</span>
            </CommandItem>
          );
        })}
      </CommandList>
    </Command>
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

  // Rendered closed rather than early-returning null: unmounting a Radix
  // modal while it is still open leaves `pointer-events: none` on <body>.
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Open file</DialogTitle>
        {projectId != null ? (
          <PickerBody port={port} projectId={projectId} chatId={chatId} onClose={handleClose} />
        ) : (
          <div data-testid="file-picker-no-project" className="py-6 text-center text-muted-foreground">
            No project selected
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
