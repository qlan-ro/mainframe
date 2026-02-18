import React from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { ErrorDot, stripErrorXml } from './shared';

export function SearchCard({
  toolName,
  args,
  result,
  isError,
}: {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean | undefined;
}) {
  const pattern = (args.pattern as string) || (args.glob as string) || '';
  const rawResultText =
    typeof result === 'string' ? result : result !== undefined ? JSON.stringify(result, null, 2) : undefined;
  const resultText = rawResultText ? stripErrorXml(rawResultText) : undefined;

  return (
    <CollapsibleToolCard
      variant="compact"
      header={
        <>
          <Search size={15} className="text-mf-text-secondary/40 shrink-0" />
          <span className="text-mf-body text-mf-text-secondary/60">{toolName}</span>
          <span className="font-mono text-mf-small text-mf-text-secondary/60 truncate" title={pattern}>
            {pattern}
          </span>
        </>
      }
      trailing={<ErrorDot isError={isError} />}
    >
      {resultText && (
        <div className="border-t border-mf-divider/50 ml-5">
          <pre
            className={cn(
              'text-mf-small font-mono overflow-x-auto whitespace-pre-wrap px-3 py-2 max-h-[300px] overflow-y-auto',
              isError ? 'text-mf-chat-error-muted bg-mf-chat-error-surface/20' : 'text-mf-text-secondary/60',
            )}
          >
            {resultText}
          </pre>
        </div>
      )}
    </CollapsibleToolCard>
  );
}
