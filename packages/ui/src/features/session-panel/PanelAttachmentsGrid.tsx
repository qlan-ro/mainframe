/**
 * PanelAttachmentsGrid — the session's attachments as one row of 48px tiles
 * ending in "+N", which expands to all of them and back.
 *
 * Same tile recipe the transcript uses for message attachments (the
 * `Attachment` compound, `extTint` for files, `variant="image"` for images), so
 * an attachment reads as the same object in both places.
 *
 * Thumbnails cost one REST call each, so only images that are on screen load (a
 * file tile renders from its name).
 *
 * The payload is directory-ordered, not chronological — `SessionAttachment`
 * carries no message id or timestamp.
 */
import { useEffect, useRef, useState } from 'react';
import type { SessionAttachment } from '@qlan-ro/mainframe-types';
import { Attachment, AttachmentMedia, AttachmentTrigger } from '@/components/ui/attachment';
import { Hint } from '@/components/ui/hint';
import { fileExtMeta } from '@/features/chat/messages/file-ext-colors';
import { ImageLightbox, type LightboxImage } from '@/features/chat/parts/ImageLightbox';
import { getAttachment, type LoadedAttachment } from '@/lib/api/attachments';

/** 48px tiles and 8px gaps in the panel's 268px text column. */
const TILES_PER_ROW = 4;
const TILE = 'size-12 rounded-tile border-border bg-queue-well p-0!';

interface PanelAttachmentsGridProps {
  port: number;
  chatId: string;
  attachments: readonly SessionAttachment[];
}

function dataUrl(loaded: LoadedAttachment): string {
  return `data:${loaded.mediaType};base64,${loaded.data}`;
}

/** The images among `shown`, loaded once each, and the ids that failed. */
function useThumbnails(port: number, chatId: string, shown: readonly SessionAttachment[]) {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LoadedAttachment>>(new Map());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // Requested ids, not the loaded map: the map only fills when a fetch RESOLVES,
  // so gating on it would re-request every image on the render in between.
  const requested = useRef(new Set<string>());

  useEffect(() => {
    for (const att of shown) {
      if (att.kind !== 'image' || requested.current.has(att.id)) continue;
      requested.current.add(att.id);
      getAttachment(port, chatId, att.id).then(
        (data) => setLoaded((prev) => new Map(prev).set(att.id, data)),
        (err: unknown) => {
          console.warn('[session-panel] attachment load failed', att.id, err);
          setFailed((prev) => new Set(prev).add(att.id));
        },
      );
    }
  }, [port, chatId, shown]);
  return { loaded, failed };
}

function Tile({
  attachment,
  data,
  onOpen,
}: {
  attachment: SessionAttachment;
  data?: LoadedAttachment;
  onOpen: () => void;
}) {
  const meta = fileExtMeta(attachment.name);
  return (
    <Hint label={attachment.name}>
      <Attachment
        data-testid={`session-panel-attachment-${attachment.id}`}
        orientation="vertical"
        className={`${TILE} overflow-hidden`}
      >
        {attachment.kind === 'image' ? (
          <>
            <AttachmentTrigger aria-label={`Open ${attachment.name}`} onClick={onOpen} />
            <AttachmentMedia variant="image" className="size-full rounded-none">
              {data && <img src={dataUrl(data)} alt={attachment.name} />}
            </AttachmentMedia>
          </>
        ) : (
          <AttachmentMedia className="size-full rounded-none bg-transparent">
            <span className="font-mono text-xs font-semibold text-ink-secondary">.{meta.ext}</span>
          </AttachmentMedia>
        )}
      </Attachment>
    </Hint>
  );
}

function MoreTile({ hiddenCount, all, onToggle }: { hiddenCount: number; all: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="session-panel-attachments-more"
      aria-expanded={all}
      aria-label={all ? 'Show fewer attachments' : `Show ${hiddenCount} more attachment${hiddenCount === 1 ? '' : 's'}`}
      onClick={onToggle}
      className="flex size-12 items-center justify-center rounded-tile border border-border bg-queue-well text-meta/[1.45] font-medium transition-colors hover:bg-sidebar-accent"
    >
      {all ? 'Less' : `+${hiddenCount}`}
    </button>
  );
}

export function PanelAttachmentsGrid({ port, chatId, attachments }: PanelAttachmentsGridProps) {
  const [all, setAll] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const overflows = attachments.length > TILES_PER_ROW;
  const shown = overflows && !all ? attachments.slice(0, TILES_PER_ROW - 1) : attachments;
  const { loaded, failed } = useThumbnails(port, chatId, shown);
  if (attachments.length === 0) return null;

  const viewable = shown.filter((att) => loaded.has(att.id));
  const lightboxImages = viewable.map((att): LightboxImage => ({ src: dataUrl(loaded.get(att.id)!), alt: att.name }));
  const failures = shown.filter((att) => failed.has(att.id)).length;

  return (
    <>
      <div data-testid="session-panel-attachment-grid" className="flex flex-wrap gap-2 px-4 pt-0.5 pb-1">
        {shown.map((att) => (
          <Tile
            key={att.id}
            attachment={att}
            data={loaded.get(att.id)}
            onOpen={() => {
              const index = viewable.indexOf(att);
              if (index >= 0) setLightboxIndex(index);
            }}
          />
        ))}
        {overflows && (
          <MoreTile hiddenCount={attachments.length - shown.length} all={all} onToggle={() => setAll(!all)} />
        )}
      </div>
      {failures > 0 && (
        <p className="px-4 pb-1 text-xs text-muted-foreground">
          {failures === 1 ? '1 preview' : `${failures} previews`} couldn’t be loaded. Hover a tile for its file name.
        </p>
      )}
      <ImageLightbox images={lightboxImages} index={lightboxIndex} onIndexChange={setLightboxIndex} />
    </>
  );
}
