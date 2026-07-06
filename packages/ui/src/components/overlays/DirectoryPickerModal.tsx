/**
 * DirectoryPickerModal — daemon-backed directory/file picker.
 *
 * Browse/tree/selection logic lives in ./directory-picker/use-picker-tree.ts.
 * On top of the baseline tree (artboard 16-dirpicker.jsx) this adds the UX pass:
 *   - an editable path crumb (PathCrumbInput) → type/paste any absolute path,
 *     reaching roots outside `~`;
 *   - a "Recent" section (RecentDirs + store/recent-directories) at the home
 *     landing for one-click re-pick of a recently-chosen project directory.
 */
import { useDirectoryPicker } from '@/features/files/use-directory-picker';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { XIcon } from 'lucide-react';
import { useRecentDirectories } from '@/store/recent-directories';
import { FlatTreeView } from './directory-picker/PickerTree';
import { usePickerTree, HOME_PATH } from './directory-picker/use-picker-tree';
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
      <DialogContent
        hideClose
        data-testid="directory-picker"
        className="flex max-h-[70vh] max-w-[480px] flex-col gap-0 p-0"
      >
        <DialogHeader className="flex-row items-center justify-between gap-2 border-b border-border px-[16px] py-[13px] shrink-0">
          <DialogTitle className="text-heading font-bold">
            {isDirectoryMode ? 'Select Project Directory' : 'Select File'}
          </DialogTitle>
          <DialogClose
            data-testid="directory-picker-close"
            aria-label="Close"
            className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
          >
            <XIcon className="size-[14px]" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>

        <PathCrumbInput value={rootPath} onNavigate={navigate} />

        <div className="min-h-[300px] flex-1 overflow-y-auto">
          {showRecent && <RecentDirs paths={recents} onPick={confirm} />}
          {rootError && (
            <p data-testid="directory-picker-error" className="px-4 py-4 text-caption text-destructive">
              {rootError}
            </p>
          )}
          {!rootError && loading && (
            <p data-testid="directory-picker-loading" className="px-4 py-[32px] text-center text-body text-mf-text-3">
              Loading…
            </p>
          )}
          {!rootError && !loading && tree.rootPaths.length === 0 && pending && (
            <p
              data-testid="directory-picker-empty"
              className="px-4 py-6 text-center text-caption text-muted-foreground"
            >
              This folder is empty.
            </p>
          )}
          {tree.rootPaths.length > 0 && (
            <FlatTreeView tree={tree} selectedPath={selectedPath} onSelect={select} onToggle={toggle} />
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border px-[16px] py-[11px] shrink-0 sm:justify-between">
          <span
            data-testid="directory-picker-selected-path"
            className="max-w-[270px] truncate font-mono text-caption text-mf-text-3"
          >
            {selectedPath ?? rootPath}
          </span>
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              data-testid="directory-picker-cancel"
              onClick={() => resolve(null)}
              className="rounded-md bg-mf-chip px-[13px] py-[7px] text-label font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="directory-picker-confirm"
              onClick={() => canConfirm && selectedPath && confirm(selectedPath)}
              disabled={!canConfirm}
              className="rounded-md bg-primary px-[15px] py-[7px] text-label font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Select
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
