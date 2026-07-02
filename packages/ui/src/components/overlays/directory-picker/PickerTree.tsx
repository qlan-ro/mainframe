/**
 * PickerTree — flat-tree row rendering for DirectoryPickerModal.
 *
 * Split out of DirectoryPickerModal.tsx (which owns fetch/state) to keep both
 * files under the 300-line limit. Renders each node plus its per-node inline
 * states: load-error, Empty (loaded, zero children), and Loading… (expanding,
 * children not yet arrived).
 */
import { ChevronRightIcon, ChevronDownIcon, FolderIcon, FileIcon } from 'lucide-react';
import type { FileTreeEntry } from '@/lib/api/files';

// ---------------------------------------------------------------------------
// Flat tree state types
// ---------------------------------------------------------------------------

export interface FlatNode {
  entry: FileTreeEntry;
  /** null = not yet loaded; [] = loaded, empty directory */
  childrenPaths: string[] | null;
  expanded: boolean;
  /** true when the child browse failed — renders a "Failed to load" row */
  loadError: boolean;
  depth: number;
}

export interface FlatTree {
  nodes: Map<string, FlatNode>;
  rootPaths: string[];
}

export const EMPTY_TREE: FlatTree = { nodes: new Map(), rootPaths: [] };

export function buildTree(entries: FileTreeEntry[], depth: number): FlatTree {
  const nodes = new Map<string, FlatNode>();
  const rootPaths: string[] = [];
  for (const e of entries) {
    rootPaths.push(e.path);
    nodes.set(e.path, { entry: e, childrenPaths: null, expanded: false, loadError: false, depth });
  }
  return { nodes, rootPaths };
}

// Design indent formula (16-dirpicker.jsx:107-109): paddingLeft = depth*16+10.
function rowIndent(depth: number): number {
  return depth * 16 + 10;
}

// Per-node inline state rows (Empty/Loading/error) sit one level deeper:
// paddingLeft = (depth+1)*16+30 (16-dirpicker.jsx:125-127, 130-132).
function nodeStateIndent(depth: number): number {
  return (depth + 1) * 16 + 30;
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
  const folderState = isSelected || expanded;

  return (
    <button
      type="button"
      data-testid={`directory-picker-row-${entry.path}`}
      onClick={() => {
        if (isDirectory) onToggle(node);
        onSelect(node);
      }}
      className={`flex w-full items-center gap-1.5 rounded-sm px-[10px] py-[5px] text-left text-body tracking-[-0.1px] outline-none ${
        isSelected
          ? 'bg-mf-selection font-semibold text-foreground'
          : 'font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      }`}
      style={{ paddingLeft: `${rowIndent(depth)}px` }}
    >
      {isDirectory ? (
        expanded ? (
          <ChevronDownIcon className="size-3 shrink-0 text-mf-text-3" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0 text-mf-text-3" />
        )
      ) : (
        <span className="size-3 shrink-0" />
      )}
      {isDirectory ? (
        <FolderIcon
          className="size-3.5 shrink-0 text-primary"
          fill={folderState ? 'currentColor' : 'none'}
          // Approximates the artboard's solid `folder.fill` glyph (16-dirpicker.jsx)
          // — lucide has no filled FolderIcon variant. 0.2 is a hand-picked
          // opacity, not a design token; revisit if a filled icon set lands.
          fillOpacity={folderState ? 0.2 : undefined}
        />
      ) : (
        <FileIcon className="size-3.5 shrink-0 text-mf-text-3" />
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
    <div className="py-[6px]">
      {rows.map(({ node, isLoadingChildren, isEmpty }) => (
        <div key={node.entry.path}>
          <PickerRow node={node} selectedPath={selectedPath} onSelect={onSelect} onToggle={onToggle} />
          {node.expanded && node.loadError && (
            <p
              data-testid={`directory-picker-load-error-${node.entry.path}`}
              className="px-3 py-0.5 text-micro text-destructive"
              style={{ paddingLeft: `${nodeStateIndent(node.depth)}px` }}
            >
              Failed to load
            </p>
          )}
          {isLoadingChildren && (
            <p
              data-testid={`directory-picker-node-loading-${node.entry.path}`}
              className="animate-pulse px-[10px] py-[4px] text-caption text-mf-text-4"
              style={{ paddingLeft: `${nodeStateIndent(node.depth)}px` }}
            >
              Loading…
            </p>
          )}
          {isEmpty && (
            <p
              data-testid={`directory-picker-node-empty-${node.entry.path}`}
              className="px-[10px] py-[4px] text-caption text-mf-text-4"
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
