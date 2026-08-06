/**
 * The tag popover, anchored to whatever opened it.
 *
 * The host is mounted at the app root rather than inside the row that opens it,
 * so the trigger's rect comes in as a prop and a zero-height anchor stands in
 * for the trigger Radix would otherwise measure.
 *
 * Confirming a delete closes the popover: two focus-trapping layers stacked on
 * each other recurse, and the confirm has to outlive the popover anyway.
 */
import { useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@v2/components/ui/popover';
import type { ThreadTagSnapshot, TagCascadeUpdate } from '@/features/sessions/tags/build-tag-cascade';
import type { TagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { TagDeleteConfirm } from './TagDeleteConfirm';
import { TagPopoverPanel } from './TagPopoverPanel';
import { useTagMutations } from './use-tag-mutations';

interface TagPopoverProps {
  open: boolean;
  onClose: () => void;
  chatId: string;
  port: number;
  currentTags: string[];
  registry: TagRegistry;
  /** Loaded threads, for the rename/delete cascade. */
  threads: ThreadTagSnapshot[];
  onCascade: (updates: TagCascadeUpdate[]) => void;
  onReload?: () => void;
  /** Viewport rect of the trigger; null anchors the popover at the origin. */
  anchorRect?: DOMRect | null;
}

export function TagPopover({
  open,
  onClose,
  chatId,
  port,
  currentTags,
  registry,
  threads,
  onCascade,
  onReload,
  anchorRect,
}: TagPopoverProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const mutations = useTagMutations({ port, chatId, currentTags, registry, threads, onCascade, onReload });

  return (
    <>
      <Popover
        open={open && confirmDelete === null}
        onOpenChange={(next) => {
          if (!next && confirmDelete === null) onClose();
        }}
      >
        {anchorRect != null && (
          <PopoverAnchor
            style={{
              position: 'fixed',
              left: anchorRect.left,
              top: anchorRect.bottom,
              width: anchorRect.width,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        )}
        <PopoverContent
          data-testid="sessions-tag-popover"
          align="start"
          className="w-60 p-0"
          // The context menu that opened this restores focus to its trigger a
          // frame later; with no trigger of our own, Radix reads that as a
          // dismiss and closes on the frame it opened. Pointer-outside and
          // Escape still dismiss.
          onFocusOutside={(e) => e.preventDefault()}
        >
          <TagPopoverPanel
            registry={registry}
            applied={new Set(currentTags)}
            mutations={mutations}
            onRequestDelete={setConfirmDelete}
          />
        </PopoverContent>
      </Popover>

      <TagDeleteConfirm
        tagName={confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={(name) => {
          setConfirmDelete(null);
          void mutations.remove(name);
        }}
      />
    </>
  );
}
