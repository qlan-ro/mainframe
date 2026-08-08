/**
 * Confirms deleting a tag from the registry.
 *
 * Deleting cascades across every session that carries the tag, which is not
 * recoverable from the UI, so it asks first.
 */
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface TagDeleteConfirmProps {
  /** The tag awaiting confirmation; null keeps the dialog closed. */
  tagName: string | null;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

export function TagDeleteConfirm({ tagName, onCancel, onConfirm }: TagDeleteConfirmProps) {
  return (
    <Dialog
      open={tagName !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent data-testid="sessions-tag-delete-confirm" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete tag</DialogTitle>
          <DialogDescription>Delete “{tagName}”? This removes it from all sessions.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" data-testid="sessions-tag-delete-confirm-cancel" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            data-testid="sessions-tag-delete-confirm-ok"
            onClick={() => {
              if (tagName !== null) onConfirm(tagName);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
