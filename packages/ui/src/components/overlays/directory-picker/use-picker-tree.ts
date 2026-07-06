/**
 * use-picker-tree — browse/tree state for the DirectoryPickerModal.
 *
 * Owns the flat tree, the current browse root, the selection, and the loading /
 * error flags, and exposes `navigate` (re-seed the tree at any absolute path —
 * this is what unlocks paste + roots outside `~`), `toggle` (lazy child expand),
 * and `select`. A monotonic `seqRef` guards stale root browses; stale child
 * browses self-guard (their target path is absent from the re-seeded tree).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { browseFilesystem } from '@/lib/api/files';
import type { PickRequest } from '@/features/files/use-directory-picker';
import { type FlatNode, type FlatTree, EMPTY_TREE, buildTree } from './PickerTree';

export const HOME_PATH = '~';

export interface PickerTree {
  tree: FlatTree;
  rootPath: string;
  selectedPath: string | null;
  selectedType: 'file' | 'directory' | null;
  rootError: string | null;
  loading: boolean;
  navigate: (path: string) => void;
  toggle: (node: FlatNode) => void;
  select: (node: FlatNode) => void;
}

export function usePickerTree(port: number, pending: PickRequest | null): PickerTree {
  const [tree, setTree] = useState<FlatTree>(EMPTY_TREE);
  const [rootPath, setRootPath] = useState<string>(HOME_PATH);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'file' | 'directory' | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const seqRef = useRef(0);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const includeFiles = pending?.mode === 'file';

  const navigate = useCallback(
    (target: string) => {
      const trimmed = target.trim();
      if (!trimmed) return;
      const seq = ++seqRef.current;
      setLoading(true);
      setRootError(null);
      browseFilesystem(port, trimmed, { includeFiles })
        .then((entries) => {
          if (seq !== seqRef.current) return;
          setLoading(false);
          setRootPath(trimmed);
          setSelectedPath(null);
          setSelectedType(null);
          setTree(buildTree(entries, 0));
        })
        .catch((err) => {
          if (seq !== seqRef.current) return;
          setLoading(false);
          console.warn('[directory-picker] browse failed', err);
          setRootError(`Couldn't open "${trimmed}". Check the path and try again.`);
        });
    },
    [port, includeFiles],
  );

  // Seed on open; reset on close. Bumping seqRef invalidates any in-flight browse.
  useEffect(() => {
    seqRef.current++;
    setTree(EMPTY_TREE);
    setRootPath(HOME_PATH);
    setSelectedPath(null);
    setSelectedType(null);
    setRootError(null);
    setLoading(false);
    if (pending) navigate(HOME_PATH);
  }, [pending, navigate]);

  const select = useCallback((node: FlatNode) => {
    setSelectedPath(node.entry.path);
    setSelectedType(node.entry.type);
  }, []);

  const toggle = useCallback(
    (node: FlatNode) => {
      const path = node.entry.path;

      // Optimistically flip the expanded flag (O(1) patch).
      setTree((prev) => {
        const existing = prev.nodes.get(path);
        if (!existing) return prev;
        const next = new Map(prev.nodes);
        next.set(path, { ...existing, expanded: !existing.expanded });
        return { ...prev, nodes: next };
      });

      // Lazy-load children on first expand (children not yet fetched).
      const current = treeRef.current.nodes.get(path);
      if (!current || current.expanded || current.childrenPaths !== null) return;

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
            next.set(path, { ...target, childrenPaths: [], loadError: true });
            return { ...prev, nodes: next };
          });
        });
    },
    [port, includeFiles],
  );

  return { tree, rootPath, selectedPath, selectedType, rootError, loading, navigate, toggle, select };
}
