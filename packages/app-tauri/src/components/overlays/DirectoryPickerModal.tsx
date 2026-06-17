/**
 * DirectoryPickerModal — daemon-backed directory/file picker.
 *
 * Tree state is a FLAT map (path → FlatNode) with a rootPaths ordering array,
 * so expand and patch are O(1) keyed updates — no recursive deep clone.
 * Seed effect uses a cancelled flag (ReviewPanel pattern) to guard stale root
 * browses. Child-expand errors set a per-node loadError flag rendered inline.
 */
import { useEffect, useState } from 'react';
import { ChevronRightIcon, ChevronDownIcon, FolderIcon, FileIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useDirectoryPicker } from '@/features/files/use-directory-picker';
import { browseFilesystem, type FileTreeEntry } from '@/lib/api/files';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';

// ---------------------------------------------------------------------------
// Flat tree state types
// ---------------------------------------------------------------------------

interface FlatNode {
  entry: FileTreeEntry;
  /** null = not yet loaded; [] = loaded, empty directory */
  childrenPaths: string[] | null;
  expanded: boolean;
  /** true when the child browse failed — renders a "Failed to load" row */
  loadError: boolean;
  depth: number;
}

interface FlatTree {
  nodes: Map<string, FlatNode>;
  rootPaths: string[];
}

const EMPTY_TREE: FlatTree = { nodes: new Map(), rootPaths: [] };

function buildTree(entries: FileTreeEntry[], depth: number): FlatTree {
  const nodes = new Map<string, FlatNode>();
  const rootPaths: string[] = [];
  for (const e of entries) {
    rootPaths.push(e.path);
    nodes.set(e.path, { entry: e, childrenPaths: null, expanded: false, loadError: false, depth });
  }
  return { nodes, rootPaths };
}

// ---------------------------------------------------------------------------
// Individual tree row
// ---------------------------------------------------------------------------

interface PickerRowProps {
  node: FlatNode;
  selectedPath: string | null;
  onSelect: (node: FlatNode) => void;
  onToggle: (node: FlatNode) => void;
}

function PickerRow({ node, selectedPath, onSelect, onToggle }: PickerRowProps) {
  const { entry, expanded, depth } = node;
  const isDirectory = entry.type === 'directory';
  const isSelected = selectedPath === entry.path;
  const indent = depth * 16;

  return (
    <button
      type="button"
      data-testid={`directory-picker-row-${entry.path}`}
      onClick={() => {
        if (isDirectory) onToggle(node);
        onSelect(node);
      }}
      className={`flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-body outline-none hover:bg-accent hover:text-accent-foreground ${isSelected ? 'bg-mf-selection text-foreground' : ''}`}
      style={{ paddingLeft: `${8 + indent}px` }}
    >
      {isDirectory ? (
        expanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )
      ) : (
        <span className="size-3.5 shrink-0" />
      )}
      {isDirectory ? (
        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Flat renderer — depth-first traversal via ordered paths
// ---------------------------------------------------------------------------

interface FlatTreeViewProps {
  tree: FlatTree;
  selectedPath: string | null;
  onSelect: (node: FlatNode) => void;
  onToggle: (node: FlatNode) => void;
}

function FlatTreeView({ tree, selectedPath, onSelect, onToggle }: FlatTreeViewProps) {
  const rows: FlatNode[] = [];

  function collect(paths: string[], visited: Set<string>) {
    for (const p of paths) {
      if (visited.has(p)) continue;
      const node = tree.nodes.get(p);
      if (!node) continue;
      visited.add(p);
      rows.push(node);
      if (node.expanded && node.childrenPaths) collect(node.childrenPaths, visited);
    }
  }

  collect(tree.rootPaths, new Set());

  return (
    <div className="py-1">
      {rows.map((node) => (
        <div key={node.entry.path}>
          <PickerRow node={node} selectedPath={selectedPath} onSelect={onSelect} onToggle={onToggle} />
          {node.expanded && node.loadError && (
            <p
              data-testid={`directory-picker-load-error-${node.entry.path}`}
              className="px-3 py-0.5 text-micro text-destructive"
              style={{ paddingLeft: `${8 + (node.depth + 1) * 16}px` }}
            >
              Failed to load
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

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

    if (!pending) return;

    let cancelled = false;
    const includeFiles = pending.mode === 'file';
    browseFilesystem(port, '~', { includeFiles })
      .then((entries) => {
        if (cancelled) return;
        setTree(buildTree(entries, 0));
      })
      .catch((err) => {
        if (cancelled) return;
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
      <DialogContent className="max-w-lg p-0 gap-0 flex flex-col max-h-[70vh]">
        <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
          <DialogTitle className="text-body">
            {pending?.title ?? (pending?.mode === 'file' ? 'Select a file' : 'Select a directory')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {rootError && <p className="px-4 py-4 text-caption text-destructive">{rootError}</p>}
          {!rootError && tree.rootPaths.length === 0 && pending && (
            <p className="px-4 py-6 text-center text-caption text-muted-foreground">Loading…</p>
          )}
          {tree.rootPaths.length > 0 && (
            <FlatTreeView tree={tree} selectedPath={selectedPath} onSelect={handleSelect} onToggle={handleToggle} />
          )}
        </div>

        <DialogFooter className="px-4 py-3 shrink-0 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="directory-picker-cancel"
            onClick={handleCancel}
            className="rounded-md px-3 py-1.5 text-body text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="directory-picker-confirm"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="rounded-md px-3 py-1.5 text-body bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending?.mode === 'file' ? 'Select' : 'Choose'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
