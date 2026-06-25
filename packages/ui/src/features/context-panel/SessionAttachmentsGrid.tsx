'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import type { SessionAttachment } from '@qlan-ro/mainframe-types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { getAttachment, type LoadedAttachment } from '@/lib/api/attachments';
import { ImageLightbox, type LightboxImage } from '@/features/chat/parts/ImageLightbox';

interface Props {
  chatId: string;
  attachments: SessionAttachment[];
}

/** Session attachment thumbnails; images open the shared multi-image lightbox. */
export function SessionAttachmentsGrid({ chatId, attachments }: Props) {
  const port = useDaemonPort();
  const [loaded, setLoaded] = useState<Map<string, LoadedAttachment>>(new Map());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    for (const att of attachments) {
      if (loaded.has(att.id)) continue;
      getAttachment(port, chatId, att.id)
        .then((data) => setLoaded((prev) => new Map(prev).set(att.id, data)))
        .catch((err) => console.warn('[context-panel] load attachment failed', err));
    }
  }, [port, chatId, attachments, loaded]);

  const imageAttachments = useMemo(() => attachments.filter((a) => a.kind === 'image'), [attachments]);
  const lightboxImages: LightboxImage[] = imageAttachments
    .map((a): LightboxImage | null => {
      const d = loaded.get(a.id);
      return d ? { src: `data:${d.mediaType};base64,${d.data}`, alt: a.name } : null;
    })
    .filter((x): x is LightboxImage => x !== null);

  if (attachments.length === 0) return null;

  return (
    <>
      <div className="mt-1 grid grid-cols-4 gap-1.5">
        {attachments.map((att) => {
          const data = loaded.get(att.id);
          const isImage = att.kind === 'image';
          return (
            <button
              key={att.id}
              type="button"
              data-testid={`sidebar-attachment-${att.id}`}
              onClick={() => {
                if (!isImage) return;
                const idx = imageAttachments.findIndex((a) => a.id === att.id);
                if (idx >= 0 && idx < lightboxImages.length) setLightboxIndex(idx);
              }}
              className="aspect-square overflow-hidden rounded-md bg-card p-1.5 transition-all hover:ring-1 hover:ring-primary"
            >
              {isImage && data ? (
                <img
                  src={`data:${data.mediaType};base64,${data.data}`}
                  alt={att.name}
                  className="h-full w-full rounded-sm object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-mf-text-3">
                  <FileText size={16} aria-hidden />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="h-7 w-full overflow-hidden break-all text-center text-[9px] leading-tight"
                        tabIndex={0}
                      >
                        {att.name}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{att.name}</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </button>
          );
        })}
      </div>
      <ImageLightbox images={lightboxImages} index={lightboxIndex} onIndexChange={setLightboxIndex} />
    </>
  );
}
