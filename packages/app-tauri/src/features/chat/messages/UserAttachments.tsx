/**
 * UserAttachments — file-attachment pills on a sent user turn (design
 * UMFileThumb): 36px ext-colored tile + filename + "TypeLabel · size".
 * Rides the NATIVE message.attachments slot (filled by convert-message);
 * sizes come from meta.attachmentPreviews (native attachments carry no size).
 * Images are NOT here — they render as native image parts (InlineImageThumbs).
 */
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { useMainframeMeta } from '../view-model/message-meta';
import { extTint, fileExtMeta } from './file-ext-colors';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function FilePill() {
  const name = useAuiState((s) => s.attachment.name);
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

/** Right-aligned wrap row; renders nothing when the message has no file attachments. */
export function UserAttachments() {
  return (
    <div data-testid="chat-user-attachments" className="flex max-w-[75%] flex-wrap justify-end gap-2 empty:hidden">
      <MessagePrimitive.Attachments>{() => <FilePill />}</MessagePrimitive.Attachments>
    </div>
  );
}
