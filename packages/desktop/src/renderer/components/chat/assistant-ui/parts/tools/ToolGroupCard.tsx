import React from 'react';
import { Layers, Eye, Search } from 'lucide-react';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { ErrorDot, shortFilename } from './shared';
import type { ToolGroupItem } from '../../convert-message';

function toolGroupSummary(items: ToolGroupItem[]): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.toolName] = (counts[item.toolName] || 0) + 1;
  }
  const segments: string[] = [];
  if (counts.Read) segments.push(`Read ${counts.Read} file${counts.Read > 1 ? 's' : ''}`);
  if (counts.Grep) segments.push(`Searched ${counts.Grep} pattern${counts.Grep > 1 ? 's' : ''}`);
  if (counts.Glob) segments.push(`Globbed ${counts.Glob} pattern${counts.Glob > 1 ? 's' : ''}`);
  return segments.join(' \u00b7 ');
}

function groupItemLabel(item: ToolGroupItem): string {
  if (item.toolName === 'Read') return shortFilename((item.args.file_path as string) || '');
  if (item.toolName === 'Grep') return (item.args.pattern as string) || '';
  if (item.toolName === 'Glob') return (item.args.pattern as string) || '';
  return item.toolName;
}

function groupItemFullPath(item: ToolGroupItem): string {
  if (item.toolName === 'Read') return (item.args.file_path as string) || '';
  if (item.toolName === 'Grep') return (item.args.pattern as string) || '';
  if (item.toolName === 'Glob') return (item.args.pattern as string) || '';
  return item.toolName;
}

function groupItemIcon(item: ToolGroupItem) {
  if (item.toolName === 'Read') return <Eye size={15} className="text-mf-text-secondary/40 shrink-0" />;
  return <Search size={15} className="text-mf-text-secondary/40 shrink-0" />;
}

export function ToolGroupCard({ args }: { args: Record<string, unknown> }) {
  const items = (args.items as ToolGroupItem[]) || [];
  const anyError = items.some((i) => i.isError);

  return (
    <CollapsibleToolCard
      variant="compact"
      header={
        <>
          <Layers size={15} className="text-mf-text-secondary/40 shrink-0" />
          <span className="text-mf-body text-mf-text-secondary/60">{toolGroupSummary(items)}</span>
        </>
      }
      trailing={anyError ? <span className="w-2 h-2 rounded-full bg-mf-chat-error shrink-0" /> : undefined}
    >
      <div className="ml-5 border-l border-mf-divider/50">
        {items.map((item) => (
          <div key={item.toolCallId} className="flex items-center gap-2 px-3 py-0.5 text-mf-small hover:bg-mf-hover/20">
            {groupItemIcon(item)}
            <span className="font-mono text-mf-text-secondary/60 truncate" title={groupItemFullPath(item)}>
              {groupItemLabel(item)}
            </span>
            <span className="flex-1" />
            <ErrorDot isError={item.isError} />
          </div>
        ))}
      </div>
    </CollapsibleToolCard>
  );
}
