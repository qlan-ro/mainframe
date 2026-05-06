import React from 'react';
import { ScrollArea } from '../ui/scroll-area';

interface File {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

interface FileTreeProps {
  files: File[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

const statusIcons: Record<string, string> = {
  added: '➕',
  modified: '📄',
  deleted: '🗑',
  renamed: '🔄',
};

export const FileTree: React.FC<FileTreeProps> = ({ files, selectedFile, onSelectFile }) => {
  return (
    <div className="flex h-full flex-col border-r border-mf-border">
      <ScrollArea className="flex-1">
        <div className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase text-mf-text-tertiary">Changes ({files.length})</h3>
          {files.map((file) => (
            <FileItem
              key={file.path}
              file={file}
              isSelected={selectedFile === file.path}
              onSelect={() => onSelectFile(file.path)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

interface FileItemProps {
  file: File;
  isSelected: boolean;
  onSelect: () => void;
}

const FileItem: React.FC<FileItemProps> = ({ file, isSelected, onSelect }) => {
  const icon = statusIcons[file.status] ?? '📄';
  const filename = file.path.split('/').pop() ?? file.path;

  return (
    <div
      onClick={onSelect}
      className={`mb-1 flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm transition-colors ${
        isSelected
          ? 'bg-mf-hover text-mf-text-primary'
          : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
      }`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="truncate font-mono text-xs">{filename}</span>
    </div>
  );
};
