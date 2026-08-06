/**
 * The directory picker's pure flat-tree model — shared between the tree hook
 * (use-picker-tree) and the v2 render layer. No React, no styling.
 */
import type { FileTreeEntry } from '@/lib/api/files';

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
