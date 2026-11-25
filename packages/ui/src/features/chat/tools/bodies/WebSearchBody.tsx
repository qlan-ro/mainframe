import { useState } from 'react';
import { searchHits } from '../shared/web-search';
import { Surface } from './Surface';

export function WebSearchBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const hits = searchHits(text);
  const hidden = hits.length - 3;
  return (
    <Surface mono={false} className="flex max-h-96 flex-col gap-1.5 overflow-y-auto px-3 py-2 font-sans text-sm/4.5">
      {hits.length ? (
        <>
          {hits.slice(0, 3).map(({ title, source }, index) => (
            <div key={index}>
              {title}
              <span className="block text-meta/[inherit] text-muted-foreground">{source}</span>
            </div>
          ))}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="cursor-pointer rounded-sm text-left text-meta/[inherit] text-muted-foreground hover:underline focus-visible:focus-line-inset"
          >
            {expanded ? 'Hide full search output' : hidden > 0 ? `${hidden} more results` : 'Full search output'}
          </button>
          {expanded && <p className="wrap-break-word whitespace-pre-wrap">{text}</p>}
        </>
      ) : (
        <p className="wrap-break-word whitespace-pre-wrap">{text}</p>
      )}
    </Surface>
  );
}
