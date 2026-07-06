/**
 * ReviewPanel — Cmd+Shift+R modal for reviewing working-tree changes.
 *
 * Three columns mirroring the prototype ReviewModal (07-review.jsx): the
 * changed-file list (ReviewFileTree), the per-file diff with its toolbar
 * (ReviewDiffPane), and the commit composer (ReviewCommitRail). The diff body
 * keeps the side-by-side CmDiffEditor and its inline comment-to-agent form
 * (posted via the assistant-ui runtime's append) alongside the commit flow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useOverlaysStore } from '@/store/overlays';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { gitCommit } from '@/lib/api/git';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { ReviewFileTree } from './ReviewFileTree';
import { ReviewDiffPane } from './ReviewDiffPane';
import { ReviewCommitRail } from './ReviewCommitRail';
import { ReviewPanelHeader } from './ReviewPanelHeader';
import { useReviewData } from './use-review-data';

export function ReviewPanel() {
  const reviewOpen = useOverlaysStore((s) => s.reviewOpen);
  const setReviewOpen = useOverlaysStore((s) => s.setReviewOpen);

  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  const runtime = useAssistantRuntime();

  const { files, totalAdditions, totalDeletions, branch, loadError } = useReviewData(
    reviewOpen,
    port,
    projectId ?? null,
    chatId,
  );

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Reset transient state whenever the panel (re)opens.
  useEffect(() => {
    if (!reviewOpen) return;
    setSelectedFile(null);
    setViewed(new Set());
    setMessage('');
    setCommitting(false);
    setCommitted(false);
    setCommitError(null);
  }, [reviewOpen]);

  // Auto-select the first file once the changed-file set loads (parity with the
  // prototype, which opens on the first diff rather than an empty prompt).
  useEffect(() => {
    if (reviewOpen && !selectedFile && files.length > 0) setSelectedFile(files[0]!.path);
  }, [reviewOpen, files, selectedFile]);

  const selected = useMemo(() => files.find((f) => f.path === selectedFile), [files, selectedFile]);
  const viewedCount = useMemo(() => files.filter((f) => viewed.has(f.path)).length, [files, viewed]);
  const unviewedCount = files.length - viewedCount;

  function handleClose() {
    setReviewOpen(false);
  }

  const handleAppend = useCallback(
    (text: string) => {
      runtime.threads.main.append({ role: 'user', content: [{ type: 'text', text }] });
    },
    [runtime],
  );

  const toggleViewed = useCallback((path: string) => {
    setViewed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  function openInWorkspace() {
    if (!selectedFile) return;
    emitSurfaceIntent({ type: 'open-file', path: selectedFile });
    handleClose();
  }

  async function handleCommit() {
    if (!projectId || !message.trim()) return;
    setCommitting(true);
    setCommitError(null);
    try {
      await gitCommit(port, projectId, message.trim(), chatId);
      setCommitted(true);
    } catch (err: unknown) {
      console.warn('[ReviewPanel] commit failed', err);
      setCommitError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Dialog open={reviewOpen} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        data-testid="review-modal"
        hideClose
        className="flex h-[86vh] w-full max-w-[1180px] flex-col gap-0 overflow-hidden p-0 max-h-[880px]"
      >
        <ReviewPanelHeader
          branch={branch}
          fileCount={files.length}
          totalAdditions={totalAdditions}
          totalDeletions={totalDeletions}
          viewedCount={viewedCount}
          onClose={handleClose}
        />

        {loadError && (
          <div data-testid="review-load-error" className="px-4 py-4 text-caption text-destructive">
            Failed to load git status. Please try again.
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="w-[264px] shrink-0 border-r border-border bg-card">
            <ReviewFileTree
              files={files}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              viewedFiles={viewed}
            />
          </div>

          <div className="min-w-0 flex-1">
            <ReviewDiffPane
              port={port}
              projectId={projectId ?? ''}
              chatId={chatId}
              file={selectedFile}
              additions={selected?.additions ?? 0}
              deletions={selected?.deletions ?? 0}
              viewed={selectedFile ? viewed.has(selectedFile) : false}
              onToggleViewed={() => selectedFile && toggleViewed(selectedFile)}
              onOpenInWorkspace={openInWorkspace}
              onAppend={handleAppend}
            />
          </div>

          <ReviewCommitRail
            fileCount={files.length}
            totalLines={totalAdditions + totalDeletions}
            unviewedCount={unviewedCount}
            message={message}
            onMessageChange={setMessage}
            onCommit={handleCommit}
            onCancel={handleClose}
            committing={committing}
            committed={committed}
            error={commitError}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
