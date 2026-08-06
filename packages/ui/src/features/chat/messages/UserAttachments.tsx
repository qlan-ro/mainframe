/**
 * UserAttachments — the user turn's native attachment row, on the v2 chat kit.
 *
 * One row through assistant-ui's `MessagePrimitive.Attachments`; each tile is the
 * kit's `Attachment` compound (aui supplies the attachment state, the kit the
 * pixels). Per attachment:
 *   - image → `AttachmentMedia variant="image"` inside an `AttachmentTrigger`
 *     that opens aui's preview Dialog, plus the sandbox-capture CONTEXT (CSS
 *     selector / annotation) when the attachment matches a meta.captures row.
 *   - file  → an ext-tinted `AttachmentMedia` + name/size, size from
 *     meta.attachmentPreviews.
 *
 * The hand-rolled thumbnail and file pill are gone; the ext accent survives as a
 * tint on the media tile, which is the only per-extension signal the kit lacks.
 *
 * Capture images are projected into message.attachments by convert-message (with
 * their image content for the preview); regular images stay plain image parts
 * (InlineImageThumbs), so they are not duplicated here.
 */
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@v2/components/ui/attachment';
import { useMainframeMeta } from '../view-model/message-meta';
import { extTint, fileExtMeta } from './file-ext-colors';
import { AttachmentPreviewDialog, useAttachmentSrc } from '@/components/ui/assistant-ui/attachment';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ── File tile ────────────────────────────────────────────────────────────────
function FilePill({ name }: { name: string }) {
  const meta = useMainframeMeta();
  const sizeBytes = meta.attachmentPreviews?.find((p) => p.name === name)?.sizeBytes;
  const m = fileExtMeta(name);

  return (
    <Attachment data-testid={`chat-user-attachment-${name}`} size="sm">
      {/* The ext accent is decorative file-type recognition and has no token —
          globals.css defines none per extension (see file-ext-colors.ts). */}
      <AttachmentMedia style={{ background: extTint(m.color) }}>
        <span className="font-mono text-xs font-bold" style={{ color: m.color }}>
          .{m.ext}
        </span>
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{name}</AttachmentTitle>
        <AttachmentDescription>
          {m.label}
          {sizeBytes != null && ` · ${formatSize(sizeBytes)}`}
        </AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  );
}

// ── Image tile (+ optional capture context) ──────────────────────────────────
function ImageAttachment({ name }: { name: string }) {
  const src = useAttachmentSrc();
  const meta = useMainframeMeta();
  const capture = meta.captures?.find((c) => c.imageName === name);
  // A bare image attachment (no capture context) needs no chrome — just the
  // clickable thumb. A capture carries its selector/annotation alongside.
  const hasContext = !!capture?.selector || !!capture?.annotation;

  const media = <AttachmentMedia variant="image">{src && <img src={src} alt="" />}</AttachmentMedia>;

  if (!hasContext) {
    return (
      <Attachment data-testid={`chat-user-attachment-${name}`} size="sm" className="min-w-0">
        <AttachmentPreviewDialog>
          <AttachmentTrigger aria-label="Open image" />
        </AttachmentPreviewDialog>
        {media}
      </Attachment>
    );
  }

  return (
    <Attachment data-testid={`chat-user-attachment-${name}`} size="sm" className="max-w-[250px]">
      <AttachmentPreviewDialog>
        <AttachmentTrigger aria-label="Open image" />
      </AttachmentPreviewDialog>
      {media}
      <AttachmentContent>
        {capture?.selector && (
          <TruncatedWithTooltip
            data-testid="chat-capture-selector"
            text={capture.selector}
            className="font-mono text-xs text-mf-code-fn"
            contentClassName="font-mono break-all"
          />
        )}
        {capture?.annotation && <AttachmentDescription>{capture.annotation}</AttachmentDescription>}
      </AttachmentContent>
    </Attachment>
  );
}

// ── Dispatch one attachment by type ──────────────────────────────────────────
function MessageAttachmentTile() {
  const type = useAuiState((s) => s.attachment.type);
  const name = useAuiState((s) => s.attachment.name);
  return type === 'image' ? <ImageAttachment name={name} /> : <FilePill name={name} />;
}

/** Right-aligned wrap row; renders nothing when the message has no attachments. */
export function UserAttachments() {
  return (
    <div data-testid="chat-user-attachments" className="flex max-w-[75%] flex-wrap justify-end gap-2 empty:hidden">
      <MessagePrimitive.Attachments>{() => <MessageAttachmentTile />}</MessagePrimitive.Attachments>
    </div>
  );
}
