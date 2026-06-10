/**
 * UserAttachments — the user turn's native attachment row (design UMFileThumb +
 * "Sent with context"). One row, rendered through assistant-ui's
 * MessagePrimitive.Attachments. Per attachment:
 *   - image → a clickable thumbnail (assistant-ui preview Dialog, click-to-open),
 *     extended with the sandbox-capture CONTEXT (CSS selector / annotation) when
 *     the attachment matches a meta.captures row by name. This replaces the old
 *     separate placeholder-chip row + duplicate image thumb.
 *   - file  → an ext-colored pill (UMFileThumb); size from meta.attachmentPreviews.
 *
 * Capture images are projected into message.attachments by convert-message (with
 * their image content for the preview); regular images stay plain image parts
 * (InlineImageThumbs), so they are not duplicated here.
 */
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { useMainframeMeta } from '../view-model/message-meta';
import { extTint, fileExtMeta } from './file-ext-colors';
import { AttachmentPreviewDialog, useAttachmentSrc } from '@/components/ui/assistant-ui/attachment';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ── File pill (UMFileThumb) ───────────────────────────────────────────────────
function FilePill({ name }: { name: string }) {
  const meta = useMainframeMeta();
  const sizeBytes = meta.attachmentPreviews?.find((p) => p.name === name)?.sizeBytes;
  const m = fileExtMeta(name);
  const subline = sizeBytes != null ? `${m.label} · ${formatSize(sizeBytes)}` : m.label;

  return (
    <div
      data-testid={`chat-user-attachment-${name}`}
      className="inline-flex items-center gap-2.5 rounded-[11px] border-[0.5px] border-border bg-card py-1.5 pl-1.5 pr-3 shadow-sm"
    >
      <span
        className="inline-flex size-9 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ background: extTint(m.color) }}
      >
        <span className="font-mono text-micro font-bold" style={{ color: m.color }}>
          .{m.ext}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <span className="max-w-[150px] truncate text-caption font-semibold text-mf-um-ink">{name}</span>
        <span className="text-micro text-mf-text-3">{subline}</span>
      </span>
    </div>
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

  const thumb = (
    <AttachmentPreviewDialog>
      <button
        type="button"
        aria-label="Open image"
        className="size-10 flex-shrink-0 overflow-hidden rounded-md border-[0.5px] border-border bg-mf-raised"
      >
        {src && <img src={src} alt="" className="size-full object-cover" />}
      </button>
    </AttachmentPreviewDialog>
  );

  if (!hasContext) {
    return <span data-testid={`chat-user-attachment-${name}`}>{thumb}</span>;
  }

  return (
    <span
      data-testid={`chat-user-attachment-${name}`}
      className="inline-flex max-w-[280px] items-center gap-2 rounded-lg border-[0.5px] border-border bg-mf-content2 py-1 pl-1 pr-2.5 text-caption text-muted-foreground"
    >
      {thumb}
      <span className="flex min-w-0 flex-col">
        {capture?.selector && (
          <code className="truncate font-mono text-caption text-mf-success">{capture.selector}</code>
        )}
        {capture?.annotation && <span className="truncate text-micro text-mf-text-3">{capture.annotation}</span>}
      </span>
    </span>
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
