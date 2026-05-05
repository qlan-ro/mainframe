import React, { useMemo } from 'react';
import { ScrollArea } from '../ui/scroll-area';

interface File {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

interface FileTreeProps {
  stagedFiles: Set<string>;
  files: File[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onToggleStaged: (path: string, staged: boolean) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
}

const statusIcons: Record<string, string> = {
  added: '➕',
  modified: '📄',
  deleted: '🗑',
  renamed: '🔄',
};

export const FileTree: React.FC<FileTreeProps> = ({
  stagedFiles,
  files,
  selectedFile,
  onSelectFile,
  onToggleStaged,
  onStageAll,
  onUnstageAll,
}) => {
  const grouped = useMemo(() => {
    const staged: File[] = [];
    const unstaged: File[] = [];

    for (const file of files) {
      if (stagedFiles.has(file.path)) {
        staged.push(file);
      } else {
        unstaged.push(file);
      }
    }
    return { staged, unstaged };
  }, [files, stagedFiles]);

  return (
    <div className="flex h-full flex-col border-r border-mf-border">
      {/* Top buttons */}
      <div className="flex gap-2 border-b border-mf-border px-4 py-3">
        <button onClick={onStageAll} className="text-xs font-medium text-mf-text-secondary hover:text-mf-text-primary">
          Stage All
        </button>
        <button
          onClick={onUnstageAll}
          className="text-xs font-medium text-mf-text-secondary hover:text-mf-text-primary"
        >
          Unstage All
        </button>
      </div>

      {/* Scrollable file list */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Staged section */}
          {grouped.staged.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase text-mf-text-tertiary">
                Staged ({grouped.staged.length})
              </h3>
              {grouped.staged.map((file) => (
                <FileItem
                  key={file.path}
                  file={file}
                  isSelected={selectedFile === file.path}
                  isStaged={true}
                  onSelect={() => {
                    onSelectFile(file.path);
                  }}
                  onToggle={() => {
                    onToggleStaged(file.path, false);
                  }}
                />
              ))}
            </div>
          )}

          {/* Unstaged section */}
          {grouped.unstaged.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-mf-text-tertiary">
                Unstaged ({grouped.unstaged.length})
              </h3>
              {grouped.unstaged.map((file) => (
                <FileItem
                  key={file.path}
                  file={file}
                  isSelected={selectedFile === file.path}
                  isStaged={false}
                  onSelect={() => {
                    onSelectFile(file.path);
                  }}
                  onToggle={() => {
                    onToggleStaged(file.path, true);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

interface FileItemProps {
  file: File;
  isSelected: boolean;
  isStaged: boolean;
  onSelect: () => void;
  onToggle: () => void;
}

const FileItem: React.FC<FileItemProps> = ({ file, isSelected, isStaged, onSelect, onToggle }) => {
  const icon = statusIcons[file.status] ?? '📄';
  const filename = file.path.split('/').pop() ?? file.path;

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onToggle();
  };

  return (
    <div
      onClick={onSelect}
      className={`mb-1 flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm transition-colors ${
        isSelected
          ? 'bg-mf-hover text-mf-text-primary'
          : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
      }`}
    >
      <input
        type="checkbox"
        checked={isStaged}
        onChange={handleCheckboxChange}
        onClick={(e) => {
          e.stopPropagation();
        }}
        className="h-3.5 w-3.5 cursor-pointer accent-mf-accent"
        aria-label={`${isStaged ? 'Unstage' : 'Stage'} ${filename}`}
      />
      <span className="text-base leading-none">{icon}</span>
      <span className="truncate font-mono text-xs">{filename}</span>
    </div>
  );
};
