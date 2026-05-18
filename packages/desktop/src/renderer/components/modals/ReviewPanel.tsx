import React, { useEffect, useState } from 'react';
import { useChatsStore } from '../../store/chats';
import { useUIStore } from '../../store/ui';
import { gitApi } from '../../lib/api/git';
import { ReviewPanelHeader } from './ReviewPanelHeader';
import { FileTree } from './FileTree';
import { DiffView } from './DiffView';

interface File {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export const ReviewPanel: React.FC = () => {
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const chats = useChatsStore((s) => s.chats);
  const activeChat = activeChatId ? chats.find((c) => c.id === activeChatId) : null;
  const reviewPanelOpen = useUIStore((s) => s.reviewPanelOpen);
  const setReviewPanelOpen = useUIStore((s) => s.setReviewPanelOpen);

  const [files, setFiles] = useState<File[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<'inline' | 'split'>('inline');
  const [error, setError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, { main: string; worktree: string }>>({});

  const isWorktree = activeChat?.worktreePath != null;

  useEffect(() => {
    if (!reviewPanelOpen || !activeChat || !activeChat.projectId) return;

    const load = async () => {
      try {
        setError(null);
        const diffRes = await gitApi.getDiff(activeChat.projectId, activeChat.id);

        const fileList = Object.keys(diffRes.diffs).map((path) => ({
          path,
          status: 'modified' as const,
        }));

        setFiles(fileList);
        setDiffs(diffRes.diffs);

        if (fileList.length > 0) {
          setSelectedFile(fileList[0]?.path ?? null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load changes');
      }
    };

    load();
  }, [reviewPanelOpen, activeChat]);

  if (!reviewPanelOpen || !activeChat) {
    return null;
  }

  const selectedFileData = files.find((f) => f.path === selectedFile);
  const selectedFileDiff = selectedFile ? diffs[selectedFile] : null;

  return (
    <div data-testid="review-modal" className="fixed inset-0 flex items-center justify-center bg-mf-overlay/60 z-50">
      <div className="flex h-5/6 w-5/6 flex-col rounded-lg border border-mf-border bg-mf-app-bg shadow-2xl">
        <ReviewPanelHeader
          isWorktree={isWorktree}
          onClose={() => setReviewPanelOpen(false)}
          filename={selectedFileData?.path ?? null}
          mode={selectedFileDiff ? diffMode : undefined}
          onModeChange={selectedFileDiff ? setDiffMode : undefined}
        />

        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 overflow-hidden">
            <FileTree files={files} selectedFile={selectedFile} onSelectFile={setSelectedFile} />
          </div>

          <div className="flex-1 overflow-hidden">
            {selectedFileData && selectedFileDiff ? (
              <DiffView
                oldCode={selectedFileDiff.main}
                newCode={selectedFileDiff.worktree}
                filename={selectedFileData.path}
                chatId={activeChat.id}
                mode={diffMode}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-mf-text-secondary">
                {files.length === 0 ? 'No changes to review' : 'Select a file to view diff'}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="border-t border-mf-border bg-mf-chat-error-surface px-4 py-2 text-sm text-mf-chat-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};
