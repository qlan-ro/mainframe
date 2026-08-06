/**
 * The attachment grid and its upload button. All of the network and pending-file
 * bookkeeping lives in `use-task-attachments`; this is the tiles.
 */
import { useRef, useState } from 'react';
import { FileIcon, UploadIcon, XIcon } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Label } from '@v2/components/ui/label';
import { AttachmentLightbox } from './AttachmentLightbox';
import { IMAGE_ACCEPT, useTaskAttachments, type AttachmentItem, type PendingAttachment } from './use-task-attachments';

interface TileProps {
  item: AttachmentItem;
  onZoom: (() => void) | null;
  onRemove: () => void;
}

function AttachmentTile({ item, onZoom, onRemove }: TileProps) {
  return (
    <div
      data-testid={`tasks-attach-${item.id}`}
      className="group/tile relative overflow-hidden rounded-md border border-border"
    >
      {onZoom != null && item.dataSrc != null ? (
        <button
          type="button"
          data-testid={`tasks-attach-zoom-${item.id}`}
          aria-label={`View ${item.filename}`}
          onClick={onZoom}
          className="block cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <img src={item.dataSrc} alt={item.filename} className="block size-20 object-cover" />
        </button>
      ) : (
        <div className="flex size-20 items-center justify-center">
          <FileIcon className="size-5 text-muted-foreground" />
        </div>
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 block truncate bg-foreground/70 px-1 py-0.5 text-xs text-background">
        {item.filename}
      </span>
      <Button
        type="button"
        data-testid={`tasks-attach-delete-${item.id}`}
        aria-label={`Remove ${item.filename}`}
        size="icon-xs"
        variant="secondary"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 opacity-0 transition-opacity group-hover/tile:opacity-100"
      >
        <XIcon />
      </Button>
    </div>
  );
}

interface TaskAttachmentsProps {
  port: number;
  todoId?: string;
  pending: PendingAttachment[];
  onPendingChange: (pending: PendingAttachment[]) => void;
  /** Surfaces the rejection reason next to the description field. */
  onRejectFile?: (reason: string) => void;
}

export function TaskAttachments({ port, todoId, pending, onPendingChange, onRejectFile }: TaskAttachmentsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { items, uploading, add, remove } = useTaskAttachments({
    port,
    todoId,
    pending,
    onPendingChange,
    onReject: onRejectFile,
  });

  // The gallery is the image subset, so a tile has to map its own id to a slide.
  const gallery = items.filter((a) => a.mimeType.startsWith('image/') && a.dataSrc != null);
  const slideOf = new Map(gallery.map((a, i) => [a.id, i] as const));

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Attachments</Label>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => {
            const slide = slideOf.get(item.id);
            return (
              <AttachmentTile
                key={item.id}
                item={item}
                onZoom={slide == null ? null : () => setLightboxIndex(slide)}
                onRemove={() => remove(item)}
              />
            );
          })}
        </div>
      )}

      <AttachmentLightbox
        images={gallery.map((a) => ({ src: a.dataSrc as string, alt: a.filename }))}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
      />

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void add(file);
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        data-testid="tasks-attach-add"
        variant="ghost"
        size="sm"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="w-fit font-normal text-muted-foreground"
      >
        <UploadIcon />
        {uploading ? 'Uploading…' : 'Add image'}
      </Button>
    </div>
  );
}
