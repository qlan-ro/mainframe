/**
 * DirectoryPickerModal — daemon-backed directory/file picker.
 *
 * Tree state is a FLAT map (path → FlatNode) with a rootPaths ordering array,
 * so expand and patch are O(1) keyed updates — no recursive deep clone.
 * Seed effect uses a cancelled flag (ReviewPanel pattern) to guard stale root
 * browses. Child-expand errors set a per-node loadError flag rendered inline.
 *
 * Row/state rendering lives in ./directory-picker/PickerTree.tsx (kept
 * separate to hold both files under the 300-line limit).
 */
import { useEffect, useState } from 'react';
import { FolderIcon, XIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { useDirectoryPicker } from '@/features/files/use-directory-picker';
import { browseFilesystem } from '@/lib/api/files';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { type FlatNode, type FlatTree, EMPTY_TREE, buildTree, FlatTreeView } from './directory-picker/PickerTree';

// ---------------------------------------------------------------------------
// Main modal component
// ---------------------------------------------------------------------------

export function DirectoryPickerModal() {
  const pending = useDirectoryPicker((s) => s.pending);
  const resolve = useDirectoryPicker((s) => s.resolve);
  const port = useDaemonPort();

  const [tree, setTree] = useState<FlatTree>(EMPTY_TREE);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'file' | 'directory' | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  // Distinguishes "browse in flight" from "browse returned an empty list" — an
  // empty directory (e.g. a fresh remote home) must show an empty state, not a
  // perpetual "Loading…" (both have rootPaths.length === 0).
  const [loading, setLoading] = useState(false);

  // Seed the tree whenever pending changes (open, close, or reopen).
  // The cancelled flag mirrors the ReviewPanel pattern: the effect cleanup
  // marks any in-flight root browse as stale so it cannot overwrite the tree
  // after a second pickDirectory supersedes the first.
  useEffect(() => {
    // Always reset UI state on any pending transition
    setTree(EMPTY_TREE);
    setSelectedPath(null);
    setSelectedType(null);
    setRootError(null);
    setLoading(false);

    if (!pending) return;

    let cancelled = false;
    setLoading(true);
    const includeFiles = pending.mode === 'file';
    browseFilesystem(port, '~', { includeFiles })
      .then((entries) => {
        if (cancelled) return;
        setLoading(false);
        setTree(buildTree(entries, 0));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        console.warn('[directory-picker] browse failed', err);
        setRootError('Failed to load directory. Please try again.');
      });

    return () => {
      cancelled = true;
    };
  }, [pending, port]);

  function handleSelect(node: FlatNode) {
    setSelectedPath(node.entry.path);
    setSelectedType(node.entry.type);
  }

  function handleToggle(node: FlatNode) {
    const path = node.entry.path;

    // Optimistically flip the expanded flag (O(1) patch)
    setTree((prev) => {
      const existing = prev.nodes.get(path);
      if (!existing) return prev;
      const next = new Map(prev.nodes);
      next.set(path, { ...existing, expanded: !existing.expanded });
      return { ...prev, nodes: next };
    });

    // Lazy-load children on first expand (children not yet fetched)
    const current = tree.nodes.get(path);
    if (!current || current.expanded || current.childrenPaths !== null) return;

    const includeFiles = pending?.mode === 'file';
    browseFilesystem(port, path, { includeFiles })
      .then((entries) => {
        setTree((prev) => {
          const target = prev.nodes.get(path);
          if (!target) return prev;
          const childrenPaths = entries.map((e) => e.path);
          const next = new Map(prev.nodes);
          for (const e of entries) {
            next.set(e.path, {
              entry: e,
              childrenPaths: null,
              expanded: false,
              loadError: false,
              depth: target.depth + 1,
            });
          }
          next.set(path, { ...target, childrenPaths, loadError: false });
          return { ...prev, nodes: next };
        });
      })
      .catch((err) => {
        console.warn('[directory-picker] child browse failed', err);
        setTree((prev) => {
          const target = prev.nodes.get(path);
          if (!target) return prev;
          const next = new Map(prev.nodes);
          // Keep the node expanded; show an error row beneath it
          next.set(path, { ...target, childrenPaths: [], loadError: true });
          return { ...prev, nodes: next };
        });
      });
  }

  const canConfirm =
    selectedPath !== null && (pending?.mode === 'directory' ? selectedType === 'directory' : selectedType === 'file');

  function handleConfirm() {
    if (canConfirm && selectedPath) resolve(selectedPath);
  }

  function handleCancel() {
    resolve(null);
  }

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
        className="max-w-[480px] p-0 gap-0 flex flex-col max-h-[70vh]"
      >
        <DialogHeader className="flex-row items-center justify-between gap-2 border-b border-border px-[16px] py-[13px] shrink-0">
          <DialogTitle className="text-heading font-bold tracking-[-0.2px]">
            {pending?.mode === 'file' ? 'Select File' : 'Select Project Directory'}
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

        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3.5 py-[7px] font-mono text-caption text-mf-text-3">
          <FolderIcon className="size-[12px] shrink-0 text-mf-text-4" fill="currentColor" />
          <span className="truncate" data-testid="directory-picker-crumb">
            ~
          </span>
        </div>

        <div className="min-h-[300px] flex-1 overflow-y-auto">
          {rootError && <p className="px-4 py-4 text-caption text-destructive">{rootError}</p>}
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
            <FlatTreeView tree={tree} selectedPath={selectedPath} onSelect={handleSelect} onToggle={handleToggle} />
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border px-[16px] py-[11px] shrink-0 sm:justify-between">
          <span
            data-testid="directory-picker-selected-path"
            className="max-w-[270px] truncate font-mono text-caption text-mf-text-3"
          >
            {selectedPath ?? '~'}
          </span>
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              data-testid="directory-picker-cancel"
              onClick={handleCancel}
              className="rounded-md bg-mf-chip px-[13px] py-[7px] text-label font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="directory-picker-confirm"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="rounded-md bg-primary px-[15px] py-[7px] text-label font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Select
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
