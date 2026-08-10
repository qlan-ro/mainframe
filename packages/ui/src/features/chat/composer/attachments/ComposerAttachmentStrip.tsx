'use client';

/**
 * The composer's pending-attachment strip and the two left-slot add buttons.
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
import type { RefObject } from 'react';
import { AtSignIcon, Paperclip, XIcon } from 'lucide-react';
import { AttachmentPrimitive, ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react';
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
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { AttachmentPreviewDialog, useAttachmentSrc } from '@/components/ui/assistant-ui/attachment';
import { extTint, fileExtMeta } from '../../messages/file-ext-colors';
import { readLiveComposerState } from '../read-live-composer-state';
import { mentionDraft, writeComposerDraft } from '../triggers/open-mention-trigger';

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
    <Attachment data-testid="composer-attachment-tile" size="sm" className="max-w-56">
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
 * and its top padding always shows above the input.
 */
export function ComposerAttachments() {
  return (
    <AttachmentGroup data-testid="composer-attachments" className="gap-2 px-3 pt-2.5 empty:hidden">
      <ComposerPrimitive.Attachments>{() => <ComposerAttachmentTile />}</ComposerPrimitive.Attachments>
    </AttachmentGroup>
  );
}

/** `onMouseDown` preventDefault on both buttons: the composer textarea must not lose focus. */
export function ComposerAddAttachment() {
  return (
    <Hint label="Add attachment">
      <ComposerPrimitive.AddAttachment asChild>
        <Button
          data-testid="composer-add-attachment"
          variant="ghost"
          size="icon-xs"
          aria-label="Add attachment"
          onMouseDown={(e) => e.preventDefault()}
        >
          <Paperclip />
        </Button>
      </ComposerPrimitive.AddAttachment>
    </Hint>
  );
}

/**
 * Opens the same mention trigger popover typing "@" does (ComposerTriggers) —
 * the design's second left-slot affordance.
 *
 * The "@" is written into the textarea through its real change path, not
 * through `composer.setText`: a programmatic write fires no DOM event, so the
 * trigger engine's tracked cursor never moves and detection finds nothing.
 */
export function ComposerAddMention({ textareaRef }: { textareaRef?: RefObject<HTMLTextAreaElement | null> }) {
  const aui = useAui();
  const handleClick = () => {
    const composer = aui.composer;
    const next = mentionDraft(readLiveComposerState(composer).text);
    const el = textareaRef?.current;
    if (!el) {
      console.warn('[composer] add-mention: no textarea ref — picker cannot open');
      composer.setText(next);
      return;
    }
    writeComposerDraft(el, next);
  };

  return (
    <Hint label="Mention a file or agent">
      <Button
        data-testid="composer-add-mention"
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Mention a file or agent"
        onClick={handleClick}
        onMouseDown={(e) => e.preventDefault()}
      >
        <AtSignIcon />
      </Button>
    </Hint>
  );
}
