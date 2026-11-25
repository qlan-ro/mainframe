'use client';

/**
 * What the draft carries above its quotes and text (C14): the pending files
 * and images, then the preview captures and code annotations. One tile shape
 * for all (`draft-content/DraftTile.tsx`); they wrap.
 *
 * aui owns the files (`ComposerPrimitive.Attachments` feeds one
 * `AttachmentPrimitive` context per pending file); the rest is
 * `draft-content-store.ts`. The adapters it needs from aui's attachment state
 * (`useAttachmentSrc`, `AttachmentPreviewDialog`) stay in the vendored
 * `components/ui/assistant-ui/attachment.tsx`.
 */
import { useEffect, useRef } from 'react';
import { AttachmentPrimitive, ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import { AttachmentPreviewDialog, useAttachmentSrc } from '@/components/ui/assistant-ui/attachment';
import { formatBytes } from '@/features/viewers/viewer-status';
import { fileExtMeta } from '../../messages/file-ext-colors';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { useActiveDraftItems } from '../draft-content/use-draft-target';
import { DraftContentTiles } from '../draft-content/DraftContentTiles';
import { DraftTile, ExtensionLead, RemoveTileButton, ThumbLead } from '../draft-content/DraftTile';
import { useImageSize } from '../draft-content/use-image-size';

function ComposerAttachmentTile() {
  const type = useAuiState((s) => s.attachment.type);
  const name = useAuiState((s) => s.attachment.name);
  const bytes = useAuiState((s) => s.attachment.file?.size);
  const src = useAttachmentSrc();
  const isImage = type === 'image';
  const dimensions = useImageSize(isImage ? src : undefined);
  const size = bytes == null ? undefined : formatBytes(bytes);
  const kind = isImage ? dimensions : undefined;
  const detail = [kind, size].filter(Boolean).join(' · ') || (isImage ? 'Image' : fileExtMeta(name).label);

  return (
    <DraftTile
      testId="composer-attachment-tile"
      lead={isImage ? <ThumbLead src={src} /> : <ExtensionLead name={name} />}
      title={name}
      detail={detail}
      full={`${name} · ${detail}`}
      remove={
        <AttachmentPrimitive.Remove asChild>
          <RemoveTileButton data-testid="composer-attachment-remove" label={`Remove ${name}`} />
        </AttachmentPrimitive.Remove>
      }
    >
      {isImage && (
        <AttachmentPreviewDialog>
          <button
            type="button"
            data-testid="composer-attachment-preview"
            aria-label={`Preview ${name}`}
            className="absolute inset-0 z-10 rounded-[9px] focus-visible:focus-line-inset"
          />
        </AttachmentPreviewDialog>
      )}
    </DraftTile>
  );
}

/** A new tile from the workspace brings the caret to the field below it, as a new quote does. */
function useFocusFieldOnAdd() {
  const ref = useRef<HTMLDivElement>(null);
  const count = useActiveDraftItems(useActiveThreadId()).length;
  const shown = useRef(count);
  useEffect(() => {
    const added = count > shown.current;
    shown.current = count;
    if (!added) return;
    ref.current
      ?.closest('[data-testid="chat-composer"]')
      ?.querySelector<HTMLTextAreaElement>('[data-testid="chat-composer-input"]')
      ?.focus();
  }, [count]);
  return ref;
}

/**
 * The strip itself. `empty:hidden` and the margin sit on the SAME element so an
 * empty strip costs no space. Past four rows it
 * scrolls, with the fifth showing.
 */
export function ComposerAttachments() {
  const ref = useFocusFieldOnAdd();
  return (
    <div
      ref={ref}
      data-testid="composer-attachments"
      className="mb-2 flex max-h-53 flex-wrap gap-2 overflow-y-auto empty:hidden"
    >
      <ComposerPrimitive.Attachments>{() => <ComposerAttachmentTile />}</ComposerPrimitive.Attachments>
      <DraftContentTiles />
    </div>
  );
}
