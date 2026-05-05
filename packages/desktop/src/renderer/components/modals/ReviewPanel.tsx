import React, { useState, useEffect } from 'react';
import { useChatsStore } from '../../store/chats';
import { gitApi } from '../../lib/api/git';
import { ReviewPanelHeader } from './ReviewPanelHeader';
import { FileTree } from './FileTree';
import { DiffView } from './DiffView';
import { ActionBar } from './ActionBar';

interface File {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

interface ReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ReviewPanel: React.FC<ReviewPanelProps> = ({ isOpen, onClose }) => {
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const chats = useChatsStore((s) => s.chats);
  const activeChat = activeChatId ? chats.find((c) => c.id === activeChatId) : null;

  const [files, setFiles] = useState<File[]>([]);
  const [stagedFiles, setStagedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<'inline' | 'split'>('inline');
  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, { main: string; worktree: string }>>({});

  const isWorktree = activeChat?.worktreePath != null;

  // Load diff and status on mount
  useEffect(() => {
    if (!isOpen || !activeChat) return;

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const [diffRes, statusRes] = await Promise.all([
          gitApi.getDiff(activeChat.projectId, activeChat.id),
          gitApi.getStatus(activeChat.id),
        ]);

        // Parse files from diff response
        const fileList = Object.keys(diffRes.diffs).map((path) => ({
          path,
          status: 'modified' as const,
        }));

        setFiles(fileList);
        setDiffs(diffRes.diffs);
        setStagedFiles(new Set(statusRes.staged));

        if (fileList.length > 0) {
          setSelectedFile(fileList[0]?.path ?? null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load changes');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [isOpen, activeChat]);

  if (!isOpen || !activeChat) {
    return null;
  }

  const selectedFileData = files.find((f) => f.path === selectedFile);
  const selectedFileDiff = selectedFile ? diffs[selectedFile] : null;

  const handleToggleStaged = async (path: string, stage: boolean) => {
    try {
      if (stage) {
        await gitApi.stageFiles(activeChat.id, [path]);
        setStagedFiles((prev) => new Set([...prev, path]));
      } else {
        await gitApi.unstageFiles(activeChat.id, [path]);
        setStagedFiles((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stage file');
    }
  };

  const handleStageAll = async () => {
    try {
      const toStage = files.filter((f) => !stagedFiles.has(f.path)).map((f) => f.path);
      if (toStage.length > 0) {
        await gitApi.stageFiles(activeChat.id, toStage);
        setStagedFiles(new Set(files.map((f) => f.path)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stage all');
    }
  };

  const handleUnstageAll = async () => {
    try {
      if (stagedFiles.size > 0) {
        await gitApi.unstageFiles(activeChat.id, Array.from(stagedFiles));
        setStagedFiles(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unstage all');
    }
  };

  const handleCommit = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const stagedList = Array.from(stagedFiles);
      await gitApi.commit(activeChat.id, commitMessage, stagedList);
      setCommitMessage('');
      setStagedFiles(new Set());
      // Reload files and diffs after commit
      const [diffRes, statusRes] = await Promise.all([
        gitApi.getDiff(activeChat.projectId, activeChat.id),
        gitApi.getStatus(activeChat.id),
      ]);
      const fileList = Object.keys(diffRes.diffs).map((path) => ({
        path,
        status: 'modified' as const,
      }));
      setFiles(fileList);
      setDiffs(diffRes.diffs);
      setStagedFiles(new Set(statusRes.staged));
      setSelectedFile(fileList.length > 0 ? (fileList[0]?.path ?? null) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenPR = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await gitApi.push(activeChat.id);
      // TODO: Call gh pr create via API or desktop shell
      // For now, show success message
      setError(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create PR');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestMessage = async () => {
    // TODO: Integrate with writing-clearly-and-concisely skill
    const message = `refactor: update ${files.length} file${files.length !== 1 ? 's' : ''}`;
    setCommitMessage(message);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
      <div className="flex h-5/6 w-5/6 flex-col rounded-lg border border-mf-border bg-mf-surface shadow-2xl">
        <ReviewPanelHeader isWorktree={isWorktree} onClose={onClose} />

        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 overflow-hidden">
            <FileTree
              stagedFiles={stagedFiles}
              files={files}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              onToggleStaged={handleToggleStaged}
              onStageAll={handleStageAll}
              onUnstageAll={handleUnstageAll}
            />
          </div>

          <div className="flex-1 overflow-hidden">
            {selectedFileData && selectedFileDiff ? (
              <DiffView
                oldCode={selectedFileDiff.main}
                newCode={selectedFileDiff.worktree}
                filename={selectedFileData.path}
                mode={diffMode}
                onModeChange={setDiffMode}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-mf-text-secondary">
                {files.length === 0 ? 'No changes to review' : 'Select a file to view diff'}
              </div>
            )}
          </div>
        </div>

        <ActionBar
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          onSuggestMessage={handleSuggestMessage}
          onCommit={handleCommit}
          onOpenPR={handleOpenPR}
          isLoading={isLoading}
        />

        {error && (
          <div className="border-t border-mf-border bg-mf-error-background px-4 py-2 text-sm text-mf-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};
