import React, { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:panels');
import type { SessionAttachment } from '@mainframe/types';
import { getAttachment } from '../../lib/api';
import { ImageLightbox } from '../chat/ImageLightbox';

interface SessionAttachmentsGridProps {
  chatId: string;
  attachments: SessionAttachment[];
}

interface LoadedAttachment {
  name: string;
  mediaType: string;
  sizeBytes: number;
  kind: 'image' | 'file';
  data: string;
  originalPath?: string;
}

export function SessionAttachmentsGrid({ chatId, attachments }: SessionAttachmentsGridProps) {
  const [loaded, setLoaded] = useState<Map<string, LoadedAttachment>>(new Map());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    for (const attachment of attachments) {
      if (loaded.has(attachment.id)) continue;
      getAttachment(chatId, attachment.id)
        .then((data) => {
          setLoaded((prev) => new Map(prev).set(attachment.id, data));
        })
        .catch((err) => log.warn('load attachment failed', { err: String(err) }));
    }
  }, [chatId, attachments, loaded]);

  if (attachments.length === 0) return null;

  const imageItems = attachments
    .map((attachment) => loaded.get(attachment.id))
    .filter((x): x is LoadedAttachment => !!x && x.kind === 'image');

  return (
    <>
      <div className="grid grid-cols-4 gap-1.5 mt-1">
        {attachments.map((attachment) => {
          const data = loaded.get(attachment.id);
          const isImage = attachment.kind === 'image';
          return (
            <button
              key={attachment.id}
              type="button"
              onClick={() => {
                if (!isImage || !data) return;
                const imageIndex = imageItems.findIndex((item) => item === data);
                if (imageIndex >= 0) setLightboxIndex(imageIndex);
              }}
              className="aspect-square rounded-mf-input overflow-hidden bg-mf-input-bg hover:ring-1 hover:ring-mf-accent transition-all p-1.5"
            >
              {isImage && data ? (
                <img
                  src={`data:${data.mediaType};base64,${data.data}`}
                  className="w-full h-full object-cover rounded-sm"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-1 text-mf-text-secondary">
                  <FileText size={16} />
                  <span
                    className="text-[9px] leading-tight w-full h-7 overflow-hidden text-center break-all"
                    title={attachment.name}
                  >
                    {attachment.name}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
      {lightboxIndex !== null && imageItems.length > 0 && (
        <ImageLightbox
          images={imageItems.map((image) => ({ mediaType: image.mediaType, data: image.data }))}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}
