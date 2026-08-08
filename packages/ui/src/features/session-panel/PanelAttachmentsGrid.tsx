/**
 * PanelAttachmentsGrid — the session's attachments as a 3-across grid of tiles.
 *
 * Same tile recipe the transcript uses for message attachments (the v2
 * `Attachment` compound, `extTint` for files, `variant="image"` for images), so
 * an attachment reads as the same object in both places. **No `size="sm"`**: it
 * sets the media to `w-8` at the same variant weight as vertical's `w-full`,
 * and CSS source order wins — the thumbnail collapses to 32px in a 90px tile.
 *
 * Thumbnails cost one REST call each, so the loader is gated twice: images
 * only (a file tile renders from its name), and only while the Context section
 * is open. Without that, every session switch fires N base64 reads.
 *
 * The payload is directory-ordered, not chronological — `SessionAttachment`
 * carries no message id or timestamp.
 */
import { useEffect, useRef, useState } from 'react';
import type { SessionAttachment } from '@qlan-ro/mainframe-types';
import { Attachment, AttachmentMedia, AttachmentTrigger } from '@/components/ui/attachment';
import { Hint } from '@/components/ui/hint';
import { extTint, fileExtMeta } from '@/features/chat/messages/file-ext-colors';
import { ImageLightbox, type LightboxImage } from '@/features/chat/parts/ImageLightbox';
import { getAttachment, type LoadedAttachment } from '@/lib/api/attachments';

interface PanelAttachmentsGridProps {
  port: number;
  chatId: string;
  attachments: readonly SessionAttachment[];
  /** False while the Context section is collapsed — see the header note. */
  enabled: boolean;
}

function dataUrl(loaded: LoadedAttachment): string {
  return `data:${loaded.mediaType};base64,${loaded.data}`;
}

export function PanelAttachmentsGrid({ port, chatId, attachments, enabled }: PanelAttachmentsGridProps) {
  const [loaded, setLoaded] = useState<Map<string, LoadedAttachment>>(new Map());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // In-flight ids, not the loaded map: the map only fills when a fetch RESOLVES,
  // so gating on it would re-request every image on the render in between.
  const requested = useRef(new Set<string>());

  useEffect(() => {
    requested.current = new Set();
    setLoaded(new Map());
    setLightboxIndex(null);
  }, [chatId]);

  useEffect(() => {
    if (!enabled) return;
    for (const att of attachments) {
      if (att.kind !== 'image' || requested.current.has(att.id)) continue;
      requested.current.add(att.id);
      getAttachment(port, chatId, att.id)
        .then((data) => setLoaded((prev) => new Map(prev).set(att.id, data)))
        .catch((err: unknown) => {
          requested.current.delete(att.id);
          console.warn('[session-panel] attachment load failed', att.id, err);
        });
    }
  }, [port, chatId, attachments, enabled]);

  if (attachments.length === 0) return null;

  const images = attachments.filter((att) => att.kind === 'image');
  const lightboxImages: LightboxImage[] = images.flatMap((att) => {
    const data = loaded.get(att.id);
    return data ? [{ src: dataUrl(data), alt: att.name }] : [];
  });

  return (
    <>
      <div data-testid="session-panel-attachment-grid" className="grid grid-cols-3 gap-1.5">
        {attachments.map((att) => {
          const meta = fileExtMeta(att.name);
          const data = loaded.get(att.id);
          const imageIndex = images.findIndex((image) => image.id === att.id);
          return (
            <Hint key={att.id} label={att.name}>
              <Attachment data-testid={`session-panel-attachment-${att.id}`} orientation="vertical" className="w-full">
                {att.kind === 'image' ? (
                  <>
                    <AttachmentTrigger
                      aria-label={`Open ${att.name}`}
                      onClick={() => {
                        if (imageIndex >= 0 && imageIndex < lightboxImages.length) setLightboxIndex(imageIndex);
                      }}
                    />
                    <AttachmentMedia variant="image">
                      {data && <img src={dataUrl(data)} alt={att.name} />}
                    </AttachmentMedia>
                  </>
                ) : (
                  // The ext accent is decorative file-type recognition and has no
                  // token — globals.css defines none per extension.
                  <AttachmentMedia style={{ background: extTint(meta.color) }}>
                    <span className="font-mono text-xs font-bold" style={{ color: meta.color }}>
                      .{meta.ext}
                    </span>
                  </AttachmentMedia>
                )}
              </Attachment>
            </Hint>
          );
        })}
      </div>
      <ImageLightbox images={lightboxImages} index={lightboxIndex} onIndexChange={setLightboxIndex} />
    </>
  );
}
