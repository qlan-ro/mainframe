/**
 * DirectoryPickerModal — daemon-backed directory/file picker.
 *
 * Opened via the useDirectoryPicker promise-bridge hook. Reads `pending` from
 * the hook's store; when non-null, renders a Dialog with a lazy tree driven by
 * browseFilesystem(port, '~', { includeFiles: mode === 'file' }).
 *
 * Expanding a directory node lazy-loads its children via a second browseFilesystem
 * call. Confirming resolves the bridge with the selected path; cancelling resolves
 * with null. The `~` seed is expanded server-side — verified fact from the plan.
 */
import { useEffect, useState } from 'react';
import { ChevronRightIcon, ChevronDownIcon, FolderIcon, FileIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useDirectoryPicker } from '@/features/files/use-directory-picker';
import { browseFilesystem, type FileTreeEntry } from '@/lib/api/files';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';

// ---------------------------------------------------------------------------
// Tree node state
// ---------------------------------------------------------------------------

interface TreeNode {
  entry: FileTreeEntry;
  children: TreeNode[] | null; // null = not yet loaded; [] = loaded empty
  expanded: boolean;
  depth: number;
}

function entriesToNodes(entries: FileTreeEntry[], depth: number): TreeNode[] {
  return entries.map((e) => ({ entry: e, children: null, expanded: false, depth }));
}

// ---------------------------------------------------------------------------
// Individual tree row
// ---------------------------------------------------------------------------

interface PickerRowProps {
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (node: TreeNode) => void;
  onToggle: (node: TreeNode) => void;
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
        if (isDirectory) {
          onToggle(node);
        }
        onSelect(node);
      }}
      className={`flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-body outline-none hover:bg-accent hover:text-accent-foreground ${isSelected ? 'bg-accent text-accent-foreground' : ''}`}
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
// Flat renderer (depth-first traversal of the tree)
// ---------------------------------------------------------------------------

interface FlatTreeProps {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelect: (node: TreeNode) => void;
  onToggle: (node: TreeNode) => void;
}

function FlatTree({ nodes, selectedPath, onSelect, onToggle }: FlatTreeProps) {
  const rows: TreeNode[] = [];
  function collect(ns: TreeNode[]) {
    for (const n of ns) {
      rows.push(n);
      if (n.expanded && n.children) collect(n.children);
    }
  }
  collect(nodes);

  return (
    <div className="py-1">
      {rows.map((node) => (
        <PickerRow
          key={node.entry.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggle={onToggle}
        />
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

  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'file' | 'directory' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seed the tree when the picker opens
  useEffect(() => {
    if (!pending) {
      setNodes([]);
      setSelectedPath(null);
      setSelectedType(null);
      setError(null);
      return;
    }
    const includeFiles = pending.mode === 'file';
    browseFilesystem(port, '~', { includeFiles })
      .then((entries) => {
        setNodes(entriesToNodes(entries, 0));
      })
      .catch((err) => {
        console.warn('[directory-picker] browse failed', err);
        setError('Failed to load directory. Please try again.');
      });
  }, [pending, port]);

  function handleSelect(node: TreeNode) {
    setSelectedPath(node.entry.path);
    setSelectedType(node.entry.type);
  }

  function handleToggle(node: TreeNode) {
    setNodes((prev) => {
      const next = structuredClone(prev);

      function findAndToggle(ns: TreeNode[]): boolean {
        for (const n of ns) {
          if (n.entry.path === node.entry.path) {
            n.expanded = !n.expanded;
            // Lazy-load children on first expand
            if (n.expanded && n.children === null) {
              const includeFiles = pending?.mode === 'file';
              browseFilesystem(port, node.entry.path, { includeFiles })
                .then((entries) => {
                  setNodes((current) => {
                    const updated = structuredClone(current);
                    function patch(ns2: TreeNode[]): boolean {
                      for (const n2 of ns2) {
                        if (n2.entry.path === node.entry.path) {
                          n2.children = entriesToNodes(entries, node.depth + 1);
                          return true;
                        }
                        if (n2.children && patch(n2.children)) return true;
                      }
                      return false;
                    }
                    patch(updated);
                    return updated;
                  });
                })
                .catch((err) => {
                  console.warn('[directory-picker] browse failed', err);
                });
            }
            return true;
          }
          if (n.children && findAndToggle(n.children)) return true;
        }
        return false;
      }

      findAndToggle(next);
      return next;
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
          {error && <p className="px-4 py-4 text-caption text-destructive">{error}</p>}
          {!error && nodes.length === 0 && pending && (
            <p className="px-4 py-6 text-center text-caption text-muted-foreground">Loading…</p>
          )}
          {nodes.length > 0 && (
            <FlatTree nodes={nodes} selectedPath={selectedPath} onSelect={handleSelect} onToggle={handleToggle} />
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
