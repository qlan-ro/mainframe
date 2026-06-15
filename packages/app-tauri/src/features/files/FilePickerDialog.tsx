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
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useFilesStore } from '@/store/files';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useFileSearch, useListNavigation, FileRow } from './use-file-search';

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
  const inputRef = useRef<HTMLInputElement>(null);

  // minLength=1: the picker searches on any non-empty keystroke (original behaviour).
  const { results, searched, loading } = useFileSearch(port, projectId, chatId, query, 1);

  // Autofocus on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

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

  const showHint = !query.trim();
  const showEmpty = query.trim().length > 0 && searched && results.length === 0;

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
        {loading && !results.length && (
          <p data-testid="file-picker-loading" className="py-6 text-center text-body text-muted-foreground">
            Searching…
          </p>
        )}
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
