import React, { useMemo } from 'react';
import { ChevronUp, ChevronDown, Crosshair, FileText, GitBranch, PanelLeftClose } from 'lucide-react';
import { structuredPatch } from 'diff';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useTabsStore, type FileView } from '../../store/tabs';
import { navigateDiff } from '../editor/diff-nav';

function computeInlineDiffStats(original?: string, modified?: string): { added: number; removed: number } | null {
  if (original == null || modified == null) return null;
  const patch = structuredPatch('', '', original, modified, '', '', { context: 0 });
  let added = 0;
  let removed = 0;
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line[0] === '+') added++;
      else if (line[0] === '-') removed++;
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
  const revealFileInTree = useTabsStore((s) => s.revealFileInTree);
  const diffChangeCount = useTabsStore((s) => s.diffChangeCount);

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
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-mf-small text-mf-text-primary truncate shrink-0" tabIndex={0}>
            {name}
          </span>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
      {dir && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-mf-small text-mf-text-secondary truncate min-w-0" tabIndex={0}>
              {dir}
            </span>
          </TooltipTrigger>
          <TooltipContent>{dir}</TooltipContent>
        </Tooltip>
      )}

      <div className="flex-1" />

      {diffChangeCount > 1 && (
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigateDiff('prev')}
                className="p-0.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                aria-label="Previous change"
              >
                <ChevronUp size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Previous change</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigateDiff('next')}
                className="p-0.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                aria-label="Next change"
              >
                <ChevronDown size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Next change</TooltipContent>
          </Tooltip>
        </div>
      )}

      {diffStats && (
        <div className="flex items-center gap-1.5 text-mf-status font-mono shrink-0">
          <span className="text-mf-success">+{diffStats.added}</span>
          <span className="text-mf-destructive">-{diffStats.removed}</span>
        </div>
      )}

      {filePath && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => revealFileInTree(filePath)}
              className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors shrink-0"
              aria-label="Select in file tree"
            >
              <Crosshair size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Select in file tree</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleFileViewCollapsed}
            className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors shrink-0"
            aria-label="Collapse file view"
          >
            <PanelLeftClose size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Collapse file view</TooltipContent>
      </Tooltip>
    </div>
  );
}
