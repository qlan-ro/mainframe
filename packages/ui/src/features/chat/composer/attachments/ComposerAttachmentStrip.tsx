'use client';

/**
 * The composer's pending-attachment strip.
 *
 * aui owns the state (`ComposerPrimitive.Attachments` feeds one
 * `AttachmentPrimitive` context per pending file); the v2 chat kit owns the
 * pixels — the same `Attachment` compound the SENT turn renders
 * (`messages/UserAttachments.tsx`), so a file looks identical either side of a
 * send. That is also why the per-extension accent lives here: it is the tile's
 * identity signal and no token can express it (see file-ext-colors.ts).
 *
 * Lives in the feature, not `components/ui/`: it reaches for chat data. Only
 * the aui-state adapters it needs (`useAttachmentSrc`, `AttachmentPreviewDialog`)
 * stay in the vendored `components/ui/assistant-ui/attachment.tsx`.
 */
import { XIcon } from 'lucide-react';
import { AttachmentPrimitive, ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@/components/ui/attachment';
import { AttachmentPreviewDialog, useAttachmentSrc } from '@/components/ui/assistant-ui/attachment';
import { extTint, fileExtMeta } from '../../messages/file-ext-colors';

/**
 * One pending attachment. The tile is labelled (name + kind), so it carries no
 * tooltip — a Hint there would only repeat the visible text.
 */
function ComposerAttachmentTile() {
  const type = useAuiState((s) => s.attachment.type);
  const name = useAuiState((s) => s.attachment.name);
  const src = useAttachmentSrc();
  const meta = fileExtMeta(name);
  const isImage = type === 'image';

  return (
    <Attachment data-testid="composer-attachment-tile" size="sm" className="w-56">
      {isImage ? (
        <>
          <AttachmentPreviewDialog>
            <AttachmentTrigger aria-label={`Preview ${name}`} />
          </AttachmentPreviewDialog>
          <AttachmentMedia variant="image">{src != null && <img src={src} alt="" />}</AttachmentMedia>
        </>
      ) : (
        <AttachmentMedia style={{ background: extTint(meta.color) }}>
          <span className="font-mono text-xs font-bold" style={{ color: meta.color }}>
            .{meta.ext}
          </span>
        </AttachmentMedia>
      )}
      <AttachmentContent>
        <AttachmentTitle>{name}</AttachmentTitle>
        <AttachmentDescription>{isImage ? 'Image' : meta.label}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentPrimitive.Remove asChild>
          <AttachmentAction data-testid="composer-attachment-remove" aria-label={`Remove ${name}`}>
            <XIcon />
          </AttachmentAction>
        </AttachmentPrimitive.Remove>
      </AttachmentActions>
    </Attachment>
  );
}

/**
 * The strip itself. `empty:hidden` and the padding sit on the SAME element so an
 * empty strip costs no space — split across two, the outer one is never `:empty`
 * and its margin always shows above the input.
 */
export function ComposerAttachments() {
  return (
    <AttachmentGroup data-testid="composer-attachments" className="mb-2 gap-2 empty:hidden">
      <ComposerPrimitive.Attachments>{() => <ComposerAttachmentTile />}</ComposerPrimitive.Attachments>
    </AttachmentGroup>
  );
}
