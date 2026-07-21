/**
 * ArchiveWorktreeDialog — mounted confirm dialog that fulfills the archive bridge (D10).
 *
 * Raised only for worktree-backed sessions, and only BEFORE the archive runs: the
 * row awaits `requestWorktreeArchiveChoice`, which sets `pending` here; the user's
 * button choice calls resolve(choice), settling that promise. Cancelling leaves
 * the session — and the user's selection — exactly as they were. A session with no
 * worktree has nothing to decide and is archived without a prompt.
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
          This session has an associated worktree. Delete it too, or keep it on disk?
        </p>
        <DialogFooter className="gap-2">
          <Button data-testid="sessions-archive-cancel" variant="ghost" onClick={() => resolve('cancel')}>
            Cancel
          </Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
