import React, { useMemo } from 'react';
import { FileText, GitBranch, PanelLeftClose } from 'lucide-react';
import { useTabsStore, type FileView } from '../../store/tabs';

function computeInlineDiffStats(original?: string, modified?: string): { added: number; removed: number } | null {
  if (original == null || modified == null) return null;
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  let added = 0;
  let removed = 0;
  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= origLines.length) {
      added++;
      continue;
    }
    if (i >= modLines.length) {
      removed++;
      continue;
    }
    if (origLines[i] !== modLines[i]) {
      added++;
      removed++;
    }
  }
  return { added, removed };
}

function splitFilePath(filePath: string): { name: string; dir: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) return { name: filePath, dir: '' };
  return { name: filePath.slice(lastSlash + 1), dir: filePath.slice(0, lastSlash + 1) };
}

function FileIcon({ fileView }: { fileView: FileView }): React.ReactElement {
  if (fileView.type === 'diff') {
    return <GitBranch size={14} className="text-mf-text-secondary shrink-0" />;
  }
  return <FileText size={14} className="text-mf-text-secondary shrink-0" />;
}

export function FileViewHeader(): React.ReactElement | null {
  const fileView = useTabsStore((s) => s.fileView);
  const toggleFileViewCollapsed = useTabsStore((s) => s.toggleFileViewCollapsed);

  const diffStats = useMemo(() => {
    if (!fileView || fileView.type !== 'diff' || fileView.source !== 'inline') return null;
    return computeInlineDiffStats(fileView.original, fileView.modified);
  }, [fileView]);

  if (!fileView) return null;

  const filePath = fileView.type === 'skill-editor' ? undefined : fileView.filePath;
  const { name, dir } = filePath ? splitFilePath(filePath) : { name: fileView.label, dir: '' };

  return (
    <div className="h-11 flex items-center gap-2 px-3 shrink-0 min-w-0">
      <FileIcon fileView={fileView} />
      <span className="font-mono text-mf-small text-mf-text-primary truncate shrink-0" title={name}>
        {name}
      </span>
      {dir && (
        <span className="font-mono text-mf-small text-mf-text-secondary truncate min-w-0" title={dir}>
          {dir}
        </span>
      )}

      <div className="flex-1" />

      {diffStats && (
        <div className="flex items-center gap-1.5 text-mf-status font-mono shrink-0">
          <span className="text-mf-success">+{diffStats.added}</span>
          <span className="text-mf-destructive">-{diffStats.removed}</span>
        </div>
      )}

      <button
        onClick={toggleFileViewCollapsed}
        className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors shrink-0"
        title="Collapse file view"
        aria-label="Collapse file view"
      >
        <PanelLeftClose size={14} />
      </button>
    </div>
  );
}
