/**
 * TaskAttachments — attachment list + upload button.
 *
 * Two modes:
 *  - Existing todo (todoId set): calls listAttachments/getAttachment/uploadAttachment/
 *    deleteAttachment directly; size/type checks are CLIENT-side only.
 *  - New (unsaved) todo (todoId undefined): pending list is lifted to the parent
 *    via `pending`/`onPendingChange`; the parent uploads them after create resolves.
 *
 * Image previews open a shared multi-image ImageLightbox (prev/next gallery
 * nav across all image attachments).
 * Port of packages/app-electron/…/todos/TodoAttachments.tsx.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, X, FileIcon } from 'lucide-react';
import { mfToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { ImageLightbox } from '@/features/chat/parts/ImageLightbox';
import {
  listAttachments,
  getAttachment,
  uploadAttachment,
  deleteAttachment,
  type AttachmentMeta,
} from '@/lib/api/todos';

export interface PendingAttachment {
  id: string;
  filename: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
}

const IMAGE_MIME = /^image\/(jpeg|png|gif|webp)$/;
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

interface LoadedAtt extends AttachmentMeta {
  data?: string;
}

interface Props {
  port: number;
  todoId?: string;
  pending: PendingAttachment[];
  onPendingChange: (pending: PendingAttachment[]) => void;
  /** Called by the modal so paste-on-description is wired here too. */
  onRejectFile?: (reason: string) => void;
}

export function TaskAttachments({ port, todoId, pending, onPendingChange, onRejectFile }: Props) {
  const [saved, setSaved] = useState<LoadedAtt[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSaved = useCallback(async () => {
    if (!todoId) return;
    try {
      const metas = await listAttachments(port, todoId);
      const full = await Promise.all(
        metas.map((m) =>
          getAttachment(port, todoId, m.id)
            .then(({ data, meta }) => ({ ...meta, data }))
            .catch(() => m as LoadedAtt),
        ),
      );
      setSaved(full);
    } catch (err) {
      console.warn('[tasks] load attachments failed', err);
      /* non-fatal — user still sees upload button */
    }
  }, [port, todoId]);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  const validateFile = (file: File): string | null => {
    if (!IMAGE_MIME.test(file.type)) return 'Only image files are supported (JPEG, PNG, GIF, WebP).';
    if (file.size > MAX_BYTES) return 'Image must be under 10 MB.';
    return null;
  };

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const err = validateFile(file);
      if (err) {
        onRejectFile?.(err);
        return;
      }
      if (todoId) {
        setUploading(true);
        try {
          const data = await readBase64(file);
          await uploadAttachment(port, todoId, {
            filename: file.name,
            mimeType: file.type,
            data,
            sizeBytes: file.size,
          });
          await loadSaved();
        } catch (err) {
          console.warn('[tasks] upload attachment failed', err);
          mfToast.error('Upload failed');
        } finally {
          setUploading(false);
        }
      } else {
        const data = await readBase64(file);
        onPendingChange([
          ...pending,
          { id: crypto.randomUUID(), filename: file.name, mimeType: file.type, data, sizeBytes: file.size },
        ]);
      }
      if (inputRef.current) inputRef.current.value = '';
    },
    [port, todoId, pending, onPendingChange, onRejectFile, loadSaved],
  );

  const handleDeleteSaved = useCallback(
    async (attId: string) => {
      if (!todoId) return;
      try {
        await deleteAttachment(port, todoId, attId);
        setSaved((prev) => prev.filter((a) => a.id !== attId));
      } catch (err) {
        console.warn('[tasks] delete attachment failed', err);
        mfToast.error('Failed to delete attachment');
      }
    },
    [port, todoId],
  );

  const removePending = (id: string) => onPendingChange(pending.filter((f) => f.id !== id));

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const allItems: Array<{ id: string; filename: string; mimeType: string; dataSrc?: string; isSaved: boolean }> = [
    ...saved.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      dataSrc: a.data ? `data:${a.mimeType};base64,${a.data}` : undefined,
      isSaved: true,
    })),
    ...pending.map((p) => ({
      id: p.id,
      filename: p.filename,
      mimeType: p.mimeType,
      dataSrc: `data:${p.mimeType};base64,${p.data}`,
      isSaved: false,
    })),
  ];

  // The image subset forms the lightbox gallery; map each image's id → its
  // index within that subset so a tile opens the gallery at the right slide.
  const galleryImages = allItems
    .filter((a) => a.mimeType.startsWith('image/') && a.dataSrc)
    .map((a) => ({ src: a.dataSrc as string, alt: a.filename }));
  const galleryIndexById = new Map(
    allItems.filter((a) => a.mimeType.startsWith('image/') && a.dataSrc).map((a, i) => [a.id, i] as const),
  );

  return (
    <div className="flex flex-col gap-1">
      <label className="text-caption text-muted-foreground">Attachments</label>
      {allItems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allItems.map((att) => {
            const isImg = att.mimeType.startsWith('image/');
            return (
              <div
                key={att.id}
                data-testid={`tasks-attach-${att.id}`}
                className="relative group rounded-md border border-border overflow-hidden bg-background"
              >
                {isImg && att.dataSrc ? (
                  <button
                    type="button"
                    data-testid={`tasks-attach-zoom-${att.id}`}
                    aria-label={`View ${att.filename}`}
                    onClick={() => setLightboxIndex(galleryIndexById.get(att.id) ?? null)}
                    className="block cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img src={att.dataSrc} alt={att.filename} className="w-20 h-20 object-cover block" />
                  </button>
                ) : (
                  <div className="w-20 h-20 flex items-center justify-center">
                    <FileIcon size={20} className="text-muted-foreground" />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 pointer-events-none">
                  <span className="text-caption text-white truncate block">{att.filename}</span>
                </div>
                <button
                  type="button"
                  data-testid={`tasks-attach-delete-${att.id}`}
                  onClick={() => (att.isSaved ? void handleDeleteSaved(att.id) : removePending(att.id))}
                  className={cn(
                    'absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white',
                    'opacity-0 group-hover:opacity-100 transition-opacity',
                  )}
                  aria-label={`Remove ${att.filename}`}
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <ImageLightbox images={galleryImages} index={lightboxIndex} onIndexChange={setLightboxIndex} />
      <input ref={inputRef} type="file" accept={IMAGE_ACCEPT} onChange={handleUpload} className="hidden" />
      <button
        type="button"
        data-testid="tasks-attach-add"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex items-center gap-1 w-fit px-2 py-1 rounded-md text-caption',
          'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
          'disabled:opacity-40',
        )}
      >
        <Upload size={12} />
        {uploading ? 'Uploading…' : 'Add image'}
      </button>
    </div>
  );
}
