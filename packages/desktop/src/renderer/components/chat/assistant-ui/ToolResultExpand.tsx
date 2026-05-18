import { useState } from 'react';
import { getToolResultContent } from '../../../lib/api/projects-api';

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export function ToolResultExpand({
  chatId,
  toolUseId,
  truncatedContent,
  fullBytes,
}: {
  chatId: string;
  toolUseId: string;
  truncatedContent: string;
  fullBytes: number;
}) {
  const [full, setFull] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const expand = async () => {
    setState('loading');
    try {
      setFull(await getToolResultContent(chatId, toolUseId));
      setState('idle');
    } catch (err) {
      console.warn('[tool-result-expand] fetch failed', err);
      setState('error');
    }
  };

  if (full !== null) {
    return (
      <div>
        <pre className="whitespace-pre-wrap break-words">{full}</pre>
        <button
          data-testid="thread-tool-result-collapse"
          type="button"
          className="text-mf-text-secondary hover:text-mf-text-primary"
          onClick={() => setFull(null)}
        >
          Collapse
        </button>
      </div>
    );
  }

  return (
    <div>
      <pre className="whitespace-pre-wrap break-words">{truncatedContent}</pre>
      {state === 'error' ? (
        <span className="text-mf-text-secondary opacity-70">full output no longer available</span>
      ) : (
        <button
          data-testid="thread-tool-result-expand"
          type="button"
          disabled={state === 'loading'}
          className="text-mf-text-secondary hover:text-mf-text-primary"
          onClick={expand}
        >
          {state === 'loading' ? 'Loading…' : `Show full output · ${fmtBytes(fullBytes)}`}
        </button>
      )}
    </div>
  );
}
