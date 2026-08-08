/**
 * The mounted confirm dialog that fulfills the archive bridge (D10).
 *
 * Raised only for worktree-backed sessions, and only BEFORE the archive runs:
 * the row awaits `requestWorktreeArchiveChoice`, which sets `pending` here; the
 * user's button choice calls resolve(choice), settling that promise. Cancelling
 * leaves the session — and the user's selection — exactly as they were. A
 * session with no worktree has nothing to decide and is archived without a
 * prompt.
 *
 * An AlertDialog with a third action rather than the ConfirmDialog recipe:
 * keep-vs-delete is a real choice, not a yes/no.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useArchivePrompt } from '@/features/sessions/runtime/archive-confirm-bridge';

export function ArchiveWorktreeDialog() {
  const pending = useArchivePrompt((s) => s.pending);
  const resolve = useArchivePrompt((s) => s.resolve);

  // Rendered closed rather than early-returning null: unmounting a Radix
  // modal while it is still open leaves `pointer-events: none` on <body>.
  return (
    <AlertDialog open={pending != null} onOpenChange={(o) => !o && resolve('cancel')}>
      <AlertDialogContent data-testid="sessions-archive-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Archive session</AlertDialogTitle>
          <AlertDialogDescription>
            This session has an associated worktree. Delete it too, or keep it on disk?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* preventDefault stops Radix's own close — otherwise onOpenChange
              fires after the click and resolves the bridge a second time
              (as 'cancel'). The store clearing `pending` closes the dialog. */}
          <AlertDialogCancel
            data-testid="sessions-archive-cancel"
            onClick={(e) => {
              e.preventDefault();
              resolve('cancel');
            }}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="sessions-archive-keep-worktree"
            className="bg-secondary text-secondary-foreground shadow-none hover:bg-secondary/80"
            onClick={(e) => {
              e.preventDefault();
              resolve({ deleteWorktree: false });
            }}
          >
            Keep worktree
          </AlertDialogAction>
          <AlertDialogAction
            data-testid="sessions-archive-delete-worktree"
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              resolve({ deleteWorktree: true });
            }}
          >
            Delete worktree
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
