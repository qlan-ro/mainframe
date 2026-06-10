/**
 * CaptureContextRow — the "sent with context" chips on a user turn (design
 * UMContextRow): one chip per sandbox capture. Element captures show a 40px
 * preview of the captured element + the CSS selector; screenshots show the
 * preview + "Screenshot". Previews resolve BY NAME: meta.attachmentPreviews'
 * kind==='image' names align positionally with the message's image parts
 * (daemon construction), so imageName → index → image part src.
 * No remove-X — that's a composer affordance; these are sent echoes.
 */
import { ImageIcon } from 'lucide-react';
import type { CaptureRow } from '../view-model/parse-captures';
import type { MainframeMessageMeta } from '../view-model/message-meta';

interface Props {
  rows: ReadonlyArray<CaptureRow>;
  /** data: URLs of the message's native image parts, in content order. */
  imageSrcs: ReadonlyArray<string>;
  previews: MainframeMessageMeta['attachmentPreviews'];
}

function srcFor(imageName: string, previews: Props['previews'], imageSrcs: Props['imageSrcs']): string | null {
  const imageNames = (previews ?? []).filter((p) => p.kind === 'image').map((p) => p.name);
  const idx = imageNames.indexOf(imageName);
  return idx >= 0 ? (imageSrcs[idx] ?? null) : null;
}

function ChipPreview({ src, accent }: { src: string | null; accent: boolean }) {
  return (
    <span className="relative inline-block size-10 flex-shrink-0 overflow-hidden rounded-md border-[0.5px] border-border bg-mf-raised">
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center">
          <ImageIcon size={14} className="text-mf-text-4" />
        </span>
      )}
      {accent && (
        <span className="pointer-events-none absolute inset-0 rounded-md shadow-[inset_0_0_0_1.5px_var(--primary)]" />
      )}
    </span>
  );
}

export function CaptureContextRow({ rows, imageSrcs, previews }: Props) {
  if (rows.length === 0) return null;
  return (
    <div data-testid="chat-user-capture-row" className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
      {rows.map((row) => {
        const src = srcFor(row.imageName, previews, imageSrcs);
        const isElement = row.label.startsWith('element');
        return (
          <span
            key={row.label}
            data-testid={`chat-user-capture-${row.label}`}
            className="inline-flex max-w-[250px] items-center gap-2 rounded-lg border-[0.5px] border-border bg-mf-content2 py-1 pl-1 pr-2.5 text-caption text-muted-foreground"
          >
            <ChipPreview src={src} accent={isElement} />
            <span className="flex min-w-0 flex-col">
              {isElement && row.selector ? (
                <code className="truncate font-mono text-caption text-mf-success">{row.selector}</code>
              ) : (
                <span className="font-medium">{isElement ? row.label : 'Screenshot'}</span>
              )}
              {row.annotation && <span className="truncate text-micro text-mf-text-3">{row.annotation}</span>}
            </span>
          </span>
        );
      })}
    </div>
  );
}
