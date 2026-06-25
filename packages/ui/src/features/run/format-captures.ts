/**
 * Encode sandbox captures into the sentinel markdown block + base64 attachment
 * items for upload. The encoding MUST round-trip with the receive-side decoder
 * in `features/chat/view-model/parse-captures.ts` — do NOT alter the sentinel,
 * the header line, or the row format without updating that file too.
 *
 * Ported verbatim from `packages/desktop/src/renderer/lib/format-captures.ts`.
 */
import { SANDBOX_CAPTURE_SENTINEL } from '@/features/chat/view-model/parse-captures';
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
  const lines: string[] = ['> **Preview captures**'];
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
