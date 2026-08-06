/**
 * Flat-tree row rendering for DirectoryPickerModal.
 *
 * Split out of DirectoryPickerModal.tsx (which owns fetch/state) to keep both
 * files under the 300-line limit. Renders each node plus its per-node inline
 * states: load-error, Empty (loaded, zero children), and Loading… (expanding,
 * children not yet arrived).
 */
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon } from 'lucide-react';
import type { FlatNode, FlatTree } from '@/components/overlays/directory-picker/picker-tree-model';

export { buildTree, EMPTY_TREE } from '@/components/overlays/directory-picker/picker-tree-model';
export type { FlatNode, FlatTree } from '@/components/overlays/directory-picker/picker-tree-model';

/** Indent formula carried from the v1 picker: depth level × 16px + row inset. */
function rowIndent(depth: number): number {
  return depth * 16 + 10;
}

/** Per-node inline state rows (Empty/Loading/error) sit one level deeper. */
function nodeStateIndent(depth: number): number {
  return (depth + 1) * 16 + 30;
}

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
  const folderState = isSelected || expanded;

  return (
    <button
      type="button"
      data-testid={`directory-picker-row-${entry.path}`}
      onClick={() => {
        if (isDirectory) onToggle(node);
        onSelect(node);
      }}
      className={`flex w-full items-center gap-1.5 rounded-sm px-2.5 py-1 text-left outline-none ${
        isSelected
          ? 'bg-primary/10 font-semibold text-foreground'
          : 'font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      }`}
      style={{ paddingLeft: `${rowIndent(depth)}px` }}
    >
      {isDirectory ? (
        expanded ? (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
        )
      ) : (
        <span className="size-3 shrink-0" />
      )}
      {isDirectory ? (
        <FolderIcon
          className="size-3.5 shrink-0 text-primary"
          fill={folderState ? 'currentColor' : 'none'}
          // lucide has no filled FolderIcon variant; 0.2 approximates the solid
          // glyph without swallowing the outline.
          fillOpacity={folderState ? 0.2 : undefined}
        />
      ) : (
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

interface FlatTreeViewProps {
  tree: FlatTree;
  selectedPath: string | null;
  onSelect: (node: FlatNode) => void;
  onToggle: (node: FlatNode) => void;
}

interface RenderRow {
  node: FlatNode;
  /** true while this node's children are being fetched (optimistic expand, childrenPaths still null) */
  isLoadingChildren: boolean;
  /** true once loaded with zero children (and no error) */
  isEmpty: boolean;
}

function collectRows(tree: FlatTree): RenderRow[] {
  const rows: RenderRow[] = [];
  const visited = new Set<string>();

  function collect(paths: string[]) {
    for (const p of paths) {
      if (visited.has(p)) continue;
      const node = tree.nodes.get(p);
      if (!node) continue;
      visited.add(p);
      const isLoadingChildren = node.expanded && node.childrenPaths === null && !node.loadError;
      const isEmpty =
        node.expanded && node.childrenPaths !== null && node.childrenPaths.length === 0 && !node.loadError;
      rows.push({ node, isLoadingChildren, isEmpty });
      if (node.expanded && node.childrenPaths) collect(node.childrenPaths);
    }
  }

  collect(tree.rootPaths);
  return rows;
}

export function FlatTreeView({ tree, selectedPath, onSelect, onToggle }: FlatTreeViewProps) {
  const rows = collectRows(tree);

  return (
    <div className="py-1.5">
      {rows.map(({ node, isLoadingChildren, isEmpty }) => (
        <div key={node.entry.path}>
          <PickerRow node={node} selectedPath={selectedPath} onSelect={onSelect} onToggle={onToggle} />
          {node.expanded && node.loadError && (
            <p
              data-testid={`directory-picker-load-error-${node.entry.path}`}
              className="px-3 py-0.5 text-xs text-destructive"
              style={{ paddingLeft: `${nodeStateIndent(node.depth)}px` }}
            >
              Failed to load
            </p>
          )}
          {isLoadingChildren && (
            <p
              data-testid={`directory-picker-node-loading-${node.entry.path}`}
              className="animate-pulse px-2.5 py-1 text-xs text-muted-foreground/70"
              style={{ paddingLeft: `${nodeStateIndent(node.depth)}px` }}
            >
              Loading…
            </p>
          )}
          {isEmpty && (
            <p
              data-testid={`directory-picker-node-empty-${node.entry.path}`}
              className="px-2.5 py-1 text-xs text-muted-foreground/70"
              style={{ paddingLeft: `${nodeStateIndent(node.depth)}px` }}
            >
              Empty
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
