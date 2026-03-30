import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, X, Image } from 'lucide-react';
import { createLogger } from '../../lib/logger';
import { todosApi, type AttachmentMeta } from '../../lib/api/todos-api';

const log = createLogger('renderer:todo-attachments');

const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp';
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

interface Props {
  todoId: string;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip data URL prefix: "data:image/png;base64,"
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function AttachmentThumbnail({ att, onDelete }: { att: AttachmentMeta; onDelete: () => void }) {
  const isImage = att.mimeType.startsWith('image/');
  return (
    <div className="relative group rounded-mf-input border border-mf-border overflow-hidden bg-mf-app-bg">
      {isImage ? (
        <img
          src={`data:${att.mimeType};base64,${(att as AttachmentMeta & { data?: string }).data ?? ''}`}
          alt={att.filename}
          className="w-20 h-20 object-cover"
        />
      ) : (
        <div className="w-20 h-20 flex items-center justify-center">
          <Image size={20} className="text-mf-text-secondary" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5">
        <span className="text-mf-status text-white truncate block">{att.filename}</span>
      </div>
      <button
        onClick={onDelete}
        className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove attachment"
        aria-label={`Remove ${att.filename}`}
      >
        <X size={10} />
      </button>
    </div>
  );
}

export function TodoAttachments({ todoId }: Props): React.ReactElement {
  const [attachments, setAttachments] = useState<(AttachmentMeta & { data?: string })[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadAttachments = useCallback(async () => {
    try {
      const metas = await todosApi.listAttachments(todoId);
      // Fetch full data (with base64) for each attachment to render thumbnails
      const full = await Promise.all(
        metas.map((m) =>
          todosApi.getAttachment(todoId, m.id).catch((err) => {
            log.warn('Failed to fetch attachment data', { id: m.id, err: String(err) });
            return m as AttachmentMeta & { data?: string };
          }),
        ),
      );
      setAttachments(full);
    } catch (err) {
      log.warn('Failed to load attachments', { err: String(err) });
    }
  }, [todoId]);

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_SIZE_BYTES) {
        log.warn('File too large', { size: file.size });
        return;
      }
      setUploading(true);
      try {
        const data = await readFileAsBase64(file);
        const meta = await todosApi.uploadAttachment(todoId, {
          filename: file.name,
          mimeType: file.type,
          data,
          sizeBytes: file.size,
        });
        setAttachments((prev) => [...prev, { ...meta, data }]);
      } catch (err) {
        log.warn('Upload failed', { err: String(err) });
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [todoId],
  );

  const handleDelete = useCallback(
    async (attachmentId: string) => {
      try {
        await todosApi.deleteAttachment(todoId, attachmentId);
        setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      } catch (err) {
        log.warn('Delete attachment failed', { err: String(err) });
      }
    },
    [todoId],
  );

  return (
    <div className="flex flex-col gap-1">
      <label className="text-mf-small text-mf-text-secondary">Attachments</label>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <AttachmentThumbnail key={att.id} att={att} onDelete={() => void handleDelete(att.id)} />
          ))}
        </div>
      )}
      <input ref={inputRef} type="file" accept={IMAGE_ACCEPT} onChange={handleUpload} className="hidden" />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1 w-fit px-2 py-1 rounded-mf-input text-mf-small text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors disabled:opacity-40"
      >
        <Upload size={12} />
        {uploading ? 'Uploading...' : 'Add image'}
      </button>
    </div>
  );
}
