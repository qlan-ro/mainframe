/**
 * Encode sandbox captures into the sentinel markdown block + base64 attachment
 * items for upload. The row format here is the inverse of `CAPTURE_ROW_RE`, so
 * the two move together — the sentinel and header come from the marker registry.
 *
 * Ported verbatim from `packages/app-electron/src/renderer/lib/format-captures.ts`.
 */
import { CAPTURE_HEADER_LINE, SANDBOX_CAPTURE_SENTINEL } from '@/features/chat/markers/message-markers';
import type { UploadAttachmentItem } from '@/lib/api/attachments';

export interface CaptureLike {
  id: string;
  type: 'element' | 'screenshot';
  imageDataUrl: string;
  selector?: string;
  /** The size of the region the user dragged; shown on the draft's tile, not sent. */
  region?: { w: number; h: number };
  annotation?: string;
}

/** `element1`, `screenshot1`, …: the name a capture has in the draft and in the message. */
export function captureLabels(captures: ReadonlyArray<Pick<CaptureLike, 'type'>>): string[] {
  let el = 0;
  let sc = 0;
  return captures.map((c) => (c.type === 'element' ? `element${(el += 1)}` : `screenshot${(sc += 1)}`));
}

/** A row is one line; a line break in it would end the block and spill the rest into the message. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function formatCaptures(captures: ReadonlyArray<CaptureLike>): {
  markdown: string;
  attachments: UploadAttachmentItem[];
} {
  if (captures.length === 0) return { markdown: '', attachments: [] };
  const attachments: UploadAttachmentItem[] = [];
  const lines: string[] = [CAPTURE_HEADER_LINE];
  const labels = captureLabels(captures);
  captures.forEach((c, index) => {
    const base64 = c.imageDataUrl.split(',')[1] ?? '';
    const label = labels[index]!;
    const name = `${label}.png`;
    attachments.push({
      name,
      mediaType: 'image/png',
      sizeBytes: Math.floor((base64.length * 3) / 4),
      kind: 'image',
      data: base64,
    });
    const sel = c.selector ? ` — selector \`${c.selector}\`` : '';
    const note = oneLine(c.annotation ?? '');
    const ann = note ? ` — "${note}"` : '';
    lines.push(`> - \`${label}\`${sel}${ann}`);
  });
  return { markdown: `${SANDBOX_CAPTURE_SENTINEL}\n${lines.join('\n')}`, attachments };
}
