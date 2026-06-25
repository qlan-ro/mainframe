/**
 * ArchiveWorktreeDialog — mounted confirm dialog that fulfills the archive bridge (D10/S5).
 *
 * Native ThreadListItemPrimitive.Archive → adapter.archive(remoteId) → the adapter
 * calls useArchivePrompt.getState().request(remoteId, { hasWorktree }). That sets
 * `pending` here; the user's button choice calls resolve(choice), settling the
 * adapter's awaited promise. A 'cancel' choice makes the adapter throw so aui
 * rolls back the optimistic archive (the row already left on the optimistic switch).
 */
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useArchivePrompt } from '../runtime/archive-confirm-bridge';

export function ArchiveWorktreeDialog() {
  const pending = useArchivePrompt((s) => s.pending);
  const resolve = useArchivePrompt((s) => s.resolve);

  if (pending == null) return null;

  return (
    <Dialog open onOpenChange={() => resolve('cancel')}>
      <DialogContent data-testid="sessions-archive-confirm-dialog">
        <DialogHeader>
          <DialogTitle>Archive session</DialogTitle>
        </DialogHeader>
        <p className="text-body text-muted-foreground">
          {pending.hasWorktree
            ? 'This session has an associated worktree. Delete it too, or keep it on disk?'
            : 'Archive this session?'}
        </p>
        <DialogFooter className="gap-2">
          <Button data-testid="sessions-archive-cancel" variant="ghost" onClick={() => resolve('cancel')}>
            Cancel
          </Button>
          {pending.hasWorktree ? (
            <>
              <Button
                data-testid="sessions-archive-keep-worktree"
                variant="outline"
                onClick={() => resolve({ deleteWorktree: false })}
              >
                Keep worktree
              </Button>
              <Button
                data-testid="sessions-archive-delete-worktree"
                variant="destructive"
                onClick={() => resolve({ deleteWorktree: true })}
              >
                Delete worktree
              </Button>
            </>
          ) : (
            <Button data-testid="sessions-archive-confirm" onClick={() => resolve({ deleteWorktree: false })}>
              Archive
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
