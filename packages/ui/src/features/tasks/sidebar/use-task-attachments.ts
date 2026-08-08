/**
 * Attachment state for the task edit modal, in two modes.
 *
 * An existing todo talks to the daemon directly. An unsaved one has nowhere to
 * upload to, so files are held in a `pending` list the modal owns and flushes
 * after `create` resolves — which is why that list is a prop, not state here.
 *
 * Size and type are checked client-side only; the daemon is the real gate.
 */
import { useCallback, useEffect, useState } from 'react';
import { mfToast } from '@/lib/toast';
import {
  deleteAttachment,
  getAttachment,
  listAttachments,
  uploadAttachment,
  type AttachmentMeta,
} from '@/lib/api/todos';

export interface PendingAttachment {
  id: string;
  filename: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
}

/** One tile in the grid, whether it lives on the daemon yet or not. */
export interface AttachmentItem {
  id: string;
  filename: string;
  mimeType: string;
  /** A `data:` URL, absent while a saved attachment's body is still loading. */
  dataSrc?: string;
  saved: boolean;
}

const IMAGE_MIME = /^image\/(jpeg|png|gif|webp)$/;
export const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp';
const MAX_BYTES = 10 * 1024 * 1024;

export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function rejectFile(file: File): string | null {
  if (!IMAGE_MIME.test(file.type)) return 'Only image files are supported (JPEG, PNG, GIF, WebP).';
  if (file.size > MAX_BYTES) return 'Image must be under 10 MB.';
  return null;
}

function dataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

interface Options {
  port: number;
  todoId?: string;
  pending: PendingAttachment[];
  onPendingChange: (pending: PendingAttachment[]) => void;
  onReject?: (reason: string) => void;
}

export interface TaskAttachments {
  items: AttachmentItem[];
  uploading: boolean;
  add: (file: File) => Promise<void>;
  remove: (item: AttachmentItem) => void;
}

export function useTaskAttachments({ port, todoId, pending, onPendingChange, onReject }: Options): TaskAttachments {
  const [saved, setSaved] = useState<AttachmentItem[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadSaved = useCallback(async () => {
    if (!todoId) return;
    try {
      const metas = await listAttachments(port, todoId);
      const withBodies = await Promise.all(metas.map((meta) => loadOne(port, todoId, meta)));
      setSaved(withBodies);
    } catch (err) {
      // Non-fatal: the upload button still works without the existing list.
      console.warn('[tasks] load attachments failed', err);
    }
  }, [port, todoId]);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  const add = useCallback(
    async (file: File) => {
      const reason = rejectFile(file);
      if (reason) {
        onReject?.(reason);
        return;
      }
      const data = await readBase64(file);
      const body = { filename: file.name, mimeType: file.type, data, sizeBytes: file.size };
      if (!todoId) {
        onPendingChange([...pending, { id: crypto.randomUUID(), ...body }]);
        return;
      }
      setUploading(true);
      try {
        await uploadAttachment(port, todoId, body);
        await loadSaved();
      } catch (err) {
        console.warn('[tasks] upload attachment failed', err);
        mfToast.error('Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [port, todoId, pending, onPendingChange, onReject, loadSaved],
  );

  const remove = useCallback(
    (item: AttachmentItem) => {
      if (!item.saved) {
        onPendingChange(pending.filter((f) => f.id !== item.id));
        return;
      }
      if (!todoId) return;
      deleteAttachment(port, todoId, item.id)
        .then(() => setSaved((prev) => prev.filter((a) => a.id !== item.id)))
        .catch((err: unknown) => {
          console.warn('[tasks] delete attachment failed', err);
          mfToast.error('Failed to delete attachment');
        });
    },
    [port, todoId, pending, onPendingChange],
  );

  const items = [
    ...saved,
    ...pending.map((p) => ({
      id: p.id,
      filename: p.filename,
      mimeType: p.mimeType,
      dataSrc: dataUrl(p.mimeType, p.data),
      saved: false,
    })),
  ];

  return { items, uploading, add, remove };
}

async function loadOne(port: number, todoId: string, meta: AttachmentMeta): Promise<AttachmentItem> {
  const base = { id: meta.id, filename: meta.filename, mimeType: meta.mimeType, saved: true };
  try {
    const { data } = await getAttachment(port, todoId, meta.id);
    return { ...base, dataSrc: dataUrl(meta.mimeType, data) };
  } catch {
    // The tile falls back to a file glyph; the metadata is still worth showing.
    return base;
  }
}
