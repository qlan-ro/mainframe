import React, { useEffect, useState } from 'react';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { getFileBinary } from '../../lib/api';

export function PdfViewer({ filePath }: { filePath: string }): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setBlobUrl(null);
    setError(null);

    let revoked = false;
    let url: string | null = null;

    getFileBinary(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => {
        if (revoked) return;
        const bytes = Uint8Array.from(atob(result.content), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'application/pdf' });
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch(() => setError('Failed to load PDF'));

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [activeProjectId, filePath, activeChatId]);

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (!blobUrl) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading...</div>
    );
  }

  return (
    <div className="h-full w-full">
      <iframe src={blobUrl} className="h-full w-full border-0" title={filePath} />
    </div>
  );
}
