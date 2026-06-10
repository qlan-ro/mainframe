/**
 * CodeRefCard — a review comment's referenced snippet (design UMCodeRef).
 * Render-only: meta.codeRef has no producer yet (the editor surface wires the
 * sender later — see the spec's daemon-contract note). Plain mono + line
 * numbers; shiki highlighting is a tracked later enhancement.
 */
import { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, CodeIcon, QuoteIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MainframeMessageMeta } from '../view-model/message-meta';

const COLLAPSED_LINES = 7;

type CodeRef = NonNullable<MainframeMessageMeta['codeRef']>;

function rangeLabel(range: CodeRef['range']): string {
  return range.end != null && range.end !== range.start ? `L${range.start}–${range.end}` : `L${range.start}`;
}

export function CodeRefCard({ codeRef }: { codeRef: CodeRef }) {
  const [expanded, setExpanded] = useState(false);
  const lines = codeRef.code.split('\n');
  const big = lines.length > COLLAPSED_LINES;
  const shown = !big || expanded ? lines : lines.slice(0, COLLAPSED_LINES);

  return (
    <div
      data-testid="chat-user-code-ref"
      className="max-w-[75%] overflow-hidden rounded-[11px] border-[0.5px] border-border bg-mf-content2 shadow-sm"
    >
      <div className="flex items-center gap-2 border-b-[0.5px] border-border bg-mf-raised px-3 py-1.5">
        <CodeIcon size={12} className="flex-shrink-0 text-primary" />
        <span className="font-mono text-caption font-semibold text-muted-foreground">{codeRef.file}</span>
        <span className="font-mono text-micro text-mf-text-4">{rangeLabel(codeRef.range)}</span>
        <span className="flex-1" />
        <span className="font-mono text-micro text-mf-text-4">{lines.length} lines</span>
        <QuoteIcon size={11} className="flex-shrink-0 text-mf-text-4" />
      </div>
      <div className="relative">
        {/* select-text: code content is copyable despite the chrome-wide
            user-select:none; the line-number gutter stays select-none. */}
        <div className={cn('select-text', expanded ? 'max-h-60 overflow-y-auto py-1.5' : 'py-1.5')}>
          {shown.map((line, i) => (
            // 18px line-height pins the line-number gutter alignment — a fixed
            // layout metric (matches the prototype), not a typography token.
            <div key={i} className="flex min-h-[18px] font-mono text-caption" style={{ lineHeight: '18px' }}>
              <span className="w-10 flex-shrink-0 select-none pr-3 text-right text-micro text-mf-text-4">
                {codeRef.range.start + i}
              </span>
              <span className="flex-1 whitespace-pre pr-3 text-foreground">{line}</span>
            </div>
          ))}
        </div>
        {big && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-b from-transparent to-mf-content2" />
        )}
      </div>
      {big && (
        <button
          type="button"
          data-testid="chat-user-code-ref-expand"
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center justify-center gap-1.5 border-t-[0.5px] border-border bg-mf-raised py-1.5 text-caption font-semibold text-primary transition-colors hover:bg-accent"
        >
          {expanded ? 'Collapse' : `Show all ${lines.length} lines`}
          {expanded ? <ChevronUpIcon size={10} /> : <ChevronDownIcon size={10} />}
        </button>
      )}
    </div>
  );
}
