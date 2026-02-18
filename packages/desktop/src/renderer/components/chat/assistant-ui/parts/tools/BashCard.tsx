import React from 'react';
import { Terminal } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { StatusDot, cardStyle, stripErrorXml, type ToolCardProps } from './shared';

export function BashCard({ args, result, isError }: ToolCardProps) {
  const command = (args.command as string) || (args.input as string) || '';
  const description = args.description as string | undefined;
  const truncatedCmd = command.length > 80 ? command.slice(0, 80) + '...' : command;
  const rawResultText =
    typeof result === 'string' ? result : result !== undefined ? JSON.stringify(result, null, 2) : undefined;
  const resultText = rawResultText ? stripErrorXml(rawResultText) : undefined;

  return (
    <CollapsibleToolCard
      wrapperClassName={cardStyle(result, isError)}
      header={
        <>
          <Terminal size={15} className="text-mf-text-secondary shrink-0" />
          <span className="font-mono text-mf-body text-mf-text-primary truncate" title={command}>
            {truncatedCmd}
          </span>
        </>
      }
      trailing={<StatusDot result={result} isError={isError} />}
      subHeader={
        description ? (
          <div
            className="px-3 pb-1.5 -mt-0.5 text-mf-small text-mf-text-secondary truncate pl-[52px]"
            title={description}
          >
            {description}
          </div>
        ) : undefined
      }
    >
      <div className="border-t border-mf-divider px-3 py-2 space-y-2">
        <pre className="text-mf-small font-mono text-mf-text-primary overflow-x-auto whitespace-pre-wrap">
          $ {command}
        </pre>
        {resultText && (
          <div className={cn('border-t border-mf-divider -mx-3 px-3 py-1.5', isError && 'bg-mf-chat-error-surface/20')}>
            <pre className="text-mf-small font-mono overflow-x-auto whitespace-pre-wrap text-mf-text-secondary max-h-[400px] overflow-y-auto">
              {resultText}
            </pre>
          </div>
        )}
      </div>
    </CollapsibleToolCard>
  );
}
