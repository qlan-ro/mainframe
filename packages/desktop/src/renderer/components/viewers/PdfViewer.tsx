import React, { useEffect, useState } from 'react';
import { useProjectsStore } from '../../store';
import { useChatsStore } from '../../store/chats';
import { getFileBinary } from '../../lib/api';

export function PdfViewer({ filePath }: { filePath: string }): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setDataUrl(null);
    setError(null);
    getFileBinary(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => {
        setDataUrl(`data:application/pdf;base64,${result.content}`);
      })
      .catch(() => setError('Failed to load PDF'));
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
    <div className="h-full w-full">
      <embed src={dataUrl} type="application/pdf" className="h-full w-full" />
    </div>
  );
}
