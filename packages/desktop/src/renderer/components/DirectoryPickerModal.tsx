import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, X } from 'lucide-react';
import { browseFilesystem, type BrowseEntry } from '../lib/api/files-api';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:dir-picker');

interface DirNode {
  name: string;
  path: string;
  children?: DirNode[];
  loading?: boolean;
  expanded?: boolean;
}

interface DirectoryPickerModalProps {
  open: boolean;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function DirectoryPickerModal({
  open,
  onSelect,
  onCancel,
}: DirectoryPickerModalProps): React.ReactElement | null {
  const [roots, setRoots] = useState<DirNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [homePath, setHomePath] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setSelectedPath(null);
    browseFilesystem()
      .then((result) => {
        setHomePath(result.path);
        setRoots(result.entries.map((e: BrowseEntry) => ({ name: e.name, path: e.path })));
      })
      .catch((err) => log.warn('failed to load home directory', { err: String(err) }));
  }, [open]);

  const toggleExpand = useCallback(async (node: DirNode, indexPath: number[]) => {
    setRoots((prev) => {
      const next = structuredClone(prev);
      let target = next;
      for (let i = 0; i < indexPath.length - 1; i++) {
        target = target[indexPath[i]!]!.children!;
      }
      const n = target[indexPath[indexPath.length - 1]!]!;

      if (n.expanded) {
        n.expanded = false;
        return next;
      }

      if (n.children) {
        n.expanded = true;
        return next;
      }

      n.loading = true;
      n.expanded = true;

      browseFilesystem(n.path)
        .then((result) => {
          setRoots((prev2) => {
            const next2 = structuredClone(prev2);
            let t = next2;
            for (let i = 0; i < indexPath.length - 1; i++) {
              t = t[indexPath[i]!]!.children!;
            }
            const node2 = t[indexPath[indexPath.length - 1]!]!;
            node2.children = result.entries.map((e: BrowseEntry) => ({ name: e.name, path: e.path }));
            node2.loading = false;
            return next2;
          });
        })
        .catch((err) => {
          log.warn('failed to load directory', { err: String(err), path: n.path });
          setRoots((prev2) => {
            const next2 = structuredClone(prev2);
            let t = next2;
            for (let i = 0; i < indexPath.length - 1; i++) {
              t = t[indexPath[i]!]!.children!;
            }
            const node2 = t[indexPath[indexPath.length - 1]!]!;
            node2.loading = false;
            node2.children = [];
            return next2;
          });
        });

      return next;
    });
  }, []);

  if (!open) return null;

  const renderNode = (node: DirNode, indexPath: number[]): React.ReactElement => {
    const depth = indexPath.length - 1;
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path}>
        <button
          onClick={() => {
            setSelectedPath(node.path);
            void toggleExpand(node, indexPath);
          }}
          className={`w-full flex items-center gap-1 px-2 py-1 text-mf-body text-left hover:bg-mf-hover/50 transition-colors ${isSelected ? 'bg-mf-hover text-mf-text-primary font-medium' : 'text-mf-text-secondary'}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {node.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={14} />
          <span className="truncate">{node.name}</span>
        </button>
        {node.expanded && node.children && (
          <div>
            {node.children.map((child, i) => renderNode(child, [...indexPath, i]))}
            {node.children.length === 0 && !node.loading && (
              <div
                className="text-mf-small text-mf-text-secondary"
                style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              >
                Empty
              </div>
            )}
          </div>
        )}
        {node.expanded && node.loading && (
          <div className="text-mf-small text-mf-text-secondary" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
            Loading...
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-[480px] max-h-[600px] bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-mf-border">
          <h2 className="text-mf-body font-semibold text-mf-text-primary">Select Project Directory</h2>
          <button onClick={onCancel} className="text-mf-text-secondary hover:text-mf-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 min-h-[300px]">
          {roots.length === 0 ? (
            <div className="px-4 py-8 text-center text-mf-text-secondary text-mf-body">Loading...</div>
          ) : (
            roots.map((node, i) => renderNode(node, [i]))
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-mf-border">
          <span className="text-mf-small text-mf-text-secondary truncate max-w-[280px]">
            {selectedPath ?? homePath}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-mf-body text-mf-text-secondary hover:text-mf-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => selectedPath && onSelect(selectedPath)}
              disabled={!selectedPath}
              className="px-3 py-1.5 text-mf-body bg-mf-accent text-white rounded-mf-card disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
