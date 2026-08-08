/**
 * Daemon-backed directory/file picker.
 *
 * Browse/tree/selection logic is imported from the shared
 * `use-picker-tree.ts`; this file is only the dialog shell. Full-bleed on
 * purpose (`p-0 gap-0`): a scrolling tree wants edge-to-edge rows and its own
 * scroll region, not the stock form padding — the one deviation from the v2
 * dialog recipe here.
 */
import { useDirectoryPicker } from '@/features/files/use-directory-picker';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useRecentDirectories } from '@/store/recent-directories';
import { usePickerTree, HOME_PATH } from '@/components/overlays/directory-picker/use-picker-tree';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FlatTreeView } from './directory-picker/PickerTree';
import { PathCrumbInput } from './directory-picker/PathCrumbInput';
import { RecentDirs } from './directory-picker/RecentDirs';

export function DirectoryPickerModal() {
  const pending = useDirectoryPicker((s) => s.pending);
  const resolve = useDirectoryPicker((s) => s.resolve);
  const port = useDaemonPort();

  const recents = useRecentDirectories((s) => s.paths);
  const addRecent = useRecentDirectories((s) => s.addRecent);

  const { tree, rootPath, selectedPath, selectedType, rootError, loading, navigate, toggle, select } = usePickerTree(
    port,
    pending,
  );

  const isDirectoryMode = pending?.mode !== 'file';
  const canConfirm =
    selectedPath !== null && (isDirectoryMode ? selectedType === 'directory' : selectedType === 'file');

  function confirm(path: string) {
    if (isDirectoryMode) addRecent(path);
    resolve(path);
  }

  // A previously-picked directory is known-good — resolve it in one click.
  const showRecent = isDirectoryMode && rootPath === HOME_PATH && !loading && !rootError && recents.length > 0;

  return (
    <Dialog
      open={pending != null}
      onOpenChange={(o) => {
        if (!o) resolve(null);
      }}
    >
      <DialogContent data-testid="directory-picker" className="flex max-h-[70vh] flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>{isDirectoryMode ? 'Select Project Directory' : 'Select File'}</DialogTitle>
        </DialogHeader>

        <PathCrumbInput value={rootPath} onNavigate={navigate} />

        <div className="min-h-72 flex-1 overflow-y-auto">
          {showRecent && <RecentDirs paths={recents} onPick={confirm} />}
          {rootError && (
            <p data-testid="directory-picker-error" className="px-4 py-4 text-xs text-destructive">
              {rootError}
            </p>
          )}
          {!rootError && loading && (
            <p data-testid="directory-picker-loading" className="px-4 py-8 text-center text-muted-foreground">
              Loading…
            </p>
          )}
          {!rootError && !loading && tree.rootPaths.length === 0 && pending && (
            <p data-testid="directory-picker-empty" className="px-4 py-6 text-center text-xs text-muted-foreground">
              This folder is empty.
            </p>
          )}
          {tree.rootPaths.length > 0 && (
            <FlatTreeView tree={tree} selectedPath={selectedPath} onSelect={select} onToggle={toggle} />
          )}
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-between border-t px-4 py-3 sm:justify-between">
          <span
            data-testid="directory-picker-selected-path"
            className="max-w-64 truncate font-mono text-xs text-muted-foreground"
          >
            {selectedPath ?? rootPath}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" data-testid="directory-picker-cancel" onClick={() => resolve(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              data-testid="directory-picker-confirm"
              disabled={!canConfirm}
              onClick={() => canConfirm && selectedPath && confirm(selectedPath)}
            >
              Select
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
