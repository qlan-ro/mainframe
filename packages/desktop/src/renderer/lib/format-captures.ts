export const SANDBOX_CAPTURE_SENTINEL = '\0__MF_SANDBOX_CAPTURE__';

export interface CaptureLike {
  id: string;
  type: 'element' | 'screenshot';
  imageDataUrl: string;
  selector?: string;
  annotation?: string;
}

export interface AttachmentItem {
  name: string;
  mediaType: string;
  sizeBytes: number;
  kind: 'image' | 'file';
  data: string;
  originalPath?: string;
}

export interface CaptureRow {
  label: string;
  imageName: string;
  selector?: string;
  annotation?: string;
}

export function formatCaptures(captures: ReadonlyArray<CaptureLike>): {
  markdown: string;
  attachments: AttachmentItem[];
} {
  if (captures.length === 0) return { markdown: '', attachments: [] };
  const attachments: AttachmentItem[] = [];
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

export function parseSandboxCaptureBlock(
  text: string,
): { rows: CaptureRow[]; rest: string } | null {
  if (!text.startsWith(SANDBOX_CAPTURE_SENTINEL)) return null;
  const body = text.slice(SANDBOX_CAPTURE_SENTINEL.length).replace(/^\n/, '');
  const all = body.split('\n');
  const rows: CaptureRow[] = [];
  let i = 0;
  if (all[i]?.trim() === '> **Preview captures**') i += 1;
  for (; i < all.length; i++) {
    const line = all[i] ?? '';
    const m = line.match(/^> - `([^`]+)`(?: — selector `([^`]+)`)?(?: — "(.*)")?$/);
    if (!m) break;
    const row: CaptureRow = { label: m[1]!, imageName: `${m[1]!}.png` };
    if (m[2]) row.selector = m[2];
    if (m[3]) row.annotation = m[3];
    rows.push(row);
  }
  const rest = all.slice(i).join('\n').trim();
  return { rows, rest };
}
