import { Search } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { StatusDot, stripErrorXml } from './shared';

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
  const path = args.path ? String(args.path) : '';
  const rawResultText =
    typeof result === 'string' ? result : result !== undefined ? JSON.stringify(result, null, 2) : undefined;
  const resultText = rawResultText ? stripErrorXml(rawResultText) : undefined;

  return (
    <CollapsibleToolCard
      variant="compact"
      wrapperClassName="border border-mf-divider rounded-mf-card overflow-hidden"
      hideToggle
      header={
        <>
          <Search size={15} className="text-mf-text-secondary/40 shrink-0" />
          <span className="text-mf-body text-mf-text-secondary/60 shrink-0">{toolName}</span>
          {pattern ? (
            <>
              <span className="text-mf-text-secondary/40 shrink-0">·</span>
              <span className="font-mono text-mf-body text-mf-text-secondary/60 truncate min-w-0">"{pattern}"</span>
            </>
          ) : null}
        </>
      }
      trailing={<StatusDot result={result} isError={isError} />}
      subHeader={
        path ? (
          <div className="px-3 pb-0.5 pl-[35px] min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="font-mono text-mf-small text-mf-text-secondary/60 truncate block">
                  in {path}
                </span>
              </TooltipTrigger>
              <TooltipContent>{path}</TooltipContent>
            </Tooltip>
          </div>
        ) : undefined
      }
    >
      {resultText && (
        <div className="border-t border-mf-divider/50">
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
