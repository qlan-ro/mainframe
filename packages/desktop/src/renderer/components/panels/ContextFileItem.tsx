import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { getSessionFile } from '../../lib/api';

interface ContextFileItemProps {
  path: string;
  displayName?: string;
  content?: string;
  chatId?: string;
  badge?: string;
}

export function ContextFileItem({ path, displayName, content, chatId, badge }: ContextFileItemProps) {
  const fileName = displayName ?? path.split('/').pop() ?? path;
  const [lazyContent, setLazyContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const displayContent = content ?? lazyContent;
  const needsLazyLoad = content === undefined && lazyContent === null;

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if ((e.target as HTMLDetailsElement).open && needsLazyLoad && chatId) {
      setLoading(true);
      getSessionFile(chatId, path)
        .then((res) => setLazyContent(res.content))
        .catch(() => setLazyContent('(unable to load file)'))
        .finally(() => setLoading(false));
    }
  };

  return (
    <details className="group" onToggle={handleToggle}>
      <summary className="flex items-center gap-2 px-2 py-1 rounded-mf-input hover:bg-mf-hover cursor-pointer text-mf-small text-mf-text-primary">
        <FileText size={14} className="text-mf-text-secondary shrink-0" />
        <span className="truncate" title={path}>
          {fileName}
        </span>
        {badge && (
          <span className="text-mf-status text-mf-text-secondary bg-mf-hover rounded-full px-1.5 shrink-0">
            {badge}
          </span>
        )}
      </summary>
      <pre className="mt-1 p-2 rounded-mf-input bg-mf-input-bg text-mf-status text-mf-text-secondary overflow-x-auto max-h-[200px] overflow-y-auto ml-4">
        {loading ? 'Loading...' : (displayContent ?? '')}
      </pre>
    </details>
  );
}
