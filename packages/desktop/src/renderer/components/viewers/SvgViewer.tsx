import React, { useEffect, useState } from 'react';
import { useProjectsStore } from '../../store';
import { useChatsStore } from '../../store/chats';
import { getFileContent } from '../../lib/api';

export function SvgViewer({ filePath }: { filePath: string }): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setDataUrl(null);
    setError(null);
    getFileContent(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => {
        const encoded = btoa(unescape(encodeURIComponent(result.content)));
        setDataUrl(`data:image/svg+xml;base64,${encoded}`);
      })
      .catch(() => setError('Failed to load SVG'));
  }, [activeProjectId, filePath, activeChatId]);

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (!dataUrl) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading...</div>;
  }

  return (
    <div className="h-full flex items-center justify-center p-4 overflow-auto bg-white/5 rounded">
      <img src={dataUrl} className="max-w-full max-h-full object-contain" alt={filePath} />
    </div>
  );
}
