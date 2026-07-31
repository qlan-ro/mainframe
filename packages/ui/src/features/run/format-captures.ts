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
  annotation?: string;
}

export function formatCaptures(captures: ReadonlyArray<CaptureLike>): {
  markdown: string;
  attachments: UploadAttachmentItem[];
} {
  if (captures.length === 0) return { markdown: '', attachments: [] };
  const attachments: UploadAttachmentItem[] = [];
  const lines: string[] = [CAPTURE_HEADER_LINE];
  let el = 0;
  let sc = 0;
  for (const c of captures) {
    const base64 = c.imageDataUrl.split(',')[1] ?? '';
    const label = c.type === 'element' ? `element${(el += 1)}` : `screenshot${(sc += 1)}`;
    const name = `${label}.png`;
    attachments.push({
      name,
      mediaType: 'image/png',
      sizeBytes: Math.floor((base64.length * 3) / 4),
      kind: 'image',
      data: base64,
    });
    const sel = c.selector ? ` — selector \`${c.selector}\`` : '';
    const ann = c.annotation ? ` — "${c.annotation}"` : '';
    lines.push(`> - \`${label}\`${sel}${ann}`);
  }
  return { markdown: `${SANDBOX_CAPTURE_SENTINEL}\n${lines.join('\n')}`, attachments };
}
