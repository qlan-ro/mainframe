/**
 * ReviewPanel — Cmd+Shift+R modal shell for reviewing working-tree changes.
 *
 * Opens when `useOverlaysStore.reviewOpen === true` (set by the intent
 * subscriber on 'open-review'). Fetches the git status on open, shows the
 * changed-file list in ReviewFileTree, and renders ReviewDiffView for the
 * selected file. Inline comments are posted back to the chat via the
 * assistant-ui runtime's `threads.main.append` call.
 */
import { useEffect, useState } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useOverlaysStore } from '@/store/overlays';
import { getGitStatus } from '@/lib/api/git';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { gitStatusToFiles, type ReviewFile } from './git-status-to-files';
import { ReviewFileTree } from './ReviewFileTree';
import { ReviewDiffView } from './ReviewDiffView';
import { ReviewPanelHeader } from './ReviewPanelHeader';

export function ReviewPanel() {
  const reviewOpen = useOverlaysStore((s) => s.reviewOpen);
  const setReviewOpen = useOverlaysStore((s) => s.setReviewOpen);

  const port = useDaemonPort();
  const { projectId, chatId, worktreePath } = useActiveIdentity();
  const runtime = useAssistantRuntime();

  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Load git status when the panel opens
  useEffect(() => {
    if (!reviewOpen || !projectId) return;
    let cancelled = false;
    setFiles([]);
    setLoadError(false);
    setSelectedFile(null);
    getGitStatus(port, projectId, chatId)
      .then((statusFiles) => {
        if (!cancelled) setFiles(gitStatusToFiles(statusFiles));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('[ReviewPanel] failed to load git status', projectId, err);
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reviewOpen, port, projectId, chatId]);

  function handleAppend(text: string) {
    runtime.threads.main.append({
      role: 'user',
      content: [{ type: 'text', text }],
    });
  }

  function handleClose() {
    setReviewOpen(false);
  }

  return (
    <Dialog
      open={reviewOpen}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent data-testid="review-modal" className="max-w-5xl w-full h-[80vh] p-0 gap-0 flex flex-col">
        <ReviewPanelHeader worktreePath={worktreePath} onClose={handleClose} />

        {loadError && (
          <div className="px-4 py-4 text-caption text-destructive">Failed to load git status. Please try again.</div>
        )}

        <div className="flex flex-1 min-h-0">
          {/* Left: file list */}
          <div className="w-64 shrink-0 border-r border-border overflow-y-auto">
            <ReviewFileTree files={files} selectedFile={selectedFile} onSelectFile={setSelectedFile} />
          </div>

          {/* Right: diff view */}
          <div className="flex-1 min-w-0">
            {selectedFile ? (
              <ReviewDiffView
                port={port}
                projectId={projectId ?? ''}
                chatId={chatId}
                file={selectedFile}
                onAppend={handleAppend}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-caption text-muted-foreground">
                Select a file to review
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
