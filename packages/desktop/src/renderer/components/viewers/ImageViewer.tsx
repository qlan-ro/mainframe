import React, { useEffect, useState } from 'react';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { getFileBinary } from '../../lib/api';
import { getFileExtension } from '../../lib/file-types';

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

export function ImageViewer({ filePath }: { filePath: string }): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setDataUrl(null);
    setError(null);
    getFileBinary(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => {
        const mime = MIME_MAP[getFileExtension(filePath)] ?? 'application/octet-stream';
        setDataUrl(`data:${mime};base64,${result.content}`);
      })
      .catch(() => setError('Failed to load image'));
  }, [activeProjectId, filePath, activeChatId]);

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (!dataUrl) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading...</div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center p-4 overflow-auto">
      <img src={dataUrl} className="max-w-full max-h-full object-contain" alt={filePath} />
    </div>
  );
}
