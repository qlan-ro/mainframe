/**
 * Delete-tag confirm dialog — extracted from TagPopover to keep that file < 300 lines.
 *
 * Rendered as a sibling of the Popover (not inside PopoverContent) to avoid
 * nested Radix FocusScope recursion in jsdom / real-browser environments.
 */
import React from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';

interface Props {
  tagName: string | null;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

export function TagDeleteConfirm({ tagName, onCancel, onConfirm }: Props): React.ReactElement {
  return (
    <Dialog
      open={tagName !== null}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent data-testid="sessions-tag-delete-confirm">
        <DialogHeader>
          <DialogTitle>Delete tag</DialogTitle>
          <DialogDescription>Delete &quot;{tagName}&quot;? This removes it from all sessions.</DialogDescription>
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
              if (tagName) onConfirm(tagName);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
