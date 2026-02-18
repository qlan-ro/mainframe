import React from 'react';
import { Wrench } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { StatusDot, cardStyle, stripErrorXml } from './shared';

export function DefaultToolCard({
  toolName,
  args,
  argsText,
  result,
  isError,
}: {
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
  result: unknown;
  isError: boolean | undefined;
}) {
  const hasResult = result !== undefined;

  return (
    <CollapsibleToolCard
      wrapperClassName={cardStyle(result, isError)}
      header={
        <>
          <Wrench size={15} className="text-mf-text-secondary shrink-0" />
          <span className="text-mf-body font-medium text-mf-text-primary">{toolName}</span>
        </>
      }
      trailing={<StatusDot result={result} isError={isError} />}
    >
      <div className="border-t border-mf-divider px-3 py-2 space-y-2">
        <div>
          <span className="text-mf-status uppercase tracking-wide font-semibold text-mf-text-secondary">Arguments</span>
          <pre className="mt-1 text-mf-small font-mono text-mf-text-secondary overflow-x-auto whitespace-pre-wrap">
            {argsText || JSON.stringify(args, null, 2)}
          </pre>
        </div>

        {hasResult && (
          <div
            className={cn(
              isError && 'bg-mf-chat-error-surface/20 border border-mf-chat-error-border/30 rounded-mf-input p-2',
            )}
          >
            <span className="text-mf-status uppercase tracking-wide font-semibold text-mf-text-secondary">Result</span>
            <pre className="mt-1 text-mf-small font-mono overflow-x-auto whitespace-pre-wrap text-mf-text-primary max-h-[400px] overflow-y-auto">
              {stripErrorXml(typeof result === 'string' ? result : JSON.stringify(result, null, 2))}
            </pre>
          </div>
        )}
      </div>
    </CollapsibleToolCard>
  );
}
