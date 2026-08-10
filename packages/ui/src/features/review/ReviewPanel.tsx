/**
 * ReviewPanel — Cmd+Shift+R modal for reviewing working-tree changes.
 *
 * Three columns mirroring the prototype ReviewModal (07-review.jsx): the
 * changed-file list (ReviewFileTree), the per-file diff with its toolbar
 * (ReviewDiffPane), and the commit composer (ReviewCommitRail). The diff body
 * keeps the side-by-side CmDiffEditor and its inline comment-to-agent form
 * (posted via the aui client's main-thread append) alongside the commit flow.
 *
 * The header's scope switcher (Session · Uncommitted · Branch) is the modal's
 * only data-source control: it drives `useWorkingChanges`, which owns all three
 * fetches and one invalidation policy. Row clicks still select into this modal's
 * own diff pane; the workspace-diff route is the pane's "Open in workspace".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAui } from '@assistant-ui/react';
// Fixed-width columns as in v1 — resizable panels land with the review
// surface port.
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
import { DEFAULT_SCOPE } from './review-scope-view';
import { useWorkingChanges, type ChangeScope } from './use-working-changes';

export function ReviewPanel() {
  const reviewOpen = useOverlaysStore((s) => s.reviewOpen);
  const setReviewOpen = useOverlaysStore((s) => s.setReviewOpen);

  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  const aui = useAui();

  const [scope, setScope] = useState<ChangeScope>(DEFAULT_SCOPE);
  const {
    files,
    totalAdditions,
    totalDeletions,
    branch,
    baseBranch,
    mergeBase,
    error: loadError,
  } = useWorkingChanges({ port, projectId, chatId, scope, enabled: reviewOpen });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Reset transient state whenever the panel (re)opens. The scope is one of
  // them by design: it is never persisted, so every open starts on Uncommitted.
  useEffect(() => {
    if (!reviewOpen) return;
    setScope(DEFAULT_SCOPE);
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

  // Each scope reports a different file set, so a selection made in one has no
  // meaning in the next; clearing it re-arms the auto-select above.
  function handleScopeChange(next: ChangeScope) {
    setScope(next);
    setSelectedFile(null);
  }

  // Reached through the root `threads` scope, not the bare `thread` one: the
  // panel is mounted at the app root, where no thread scope is bound.
  const handleAppend = useCallback(
    (text: string) => {
      aui
        .threads()
        .thread('main')
        .append({ role: 'user', content: [{ type: 'text', text }] });
    },
    [aui],
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
        showCloseButton={false}
        className="flex h-[86vh] max-h-[880px] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[1180px]"
      >
        <ReviewPanelHeader
          scope={scope}
          onScopeChange={handleScopeChange}
          branch={branch}
          baseBranch={baseBranch}
          mergeBase={mergeBase}
          fileCount={files.length}
          totalAdditions={totalAdditions}
          totalDeletions={totalDeletions}
          viewedCount={viewedCount}
          onClose={handleClose}
        />

        {loadError && (
          <div data-testid="review-load-error" className="px-4 py-4 text-xs text-destructive">
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
            totalLines={(totalAdditions ?? 0) + (totalDeletions ?? 0)}
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
