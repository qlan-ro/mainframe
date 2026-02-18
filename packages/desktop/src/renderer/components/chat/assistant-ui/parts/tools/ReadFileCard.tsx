import React from 'react';
import { Eye } from 'lucide-react';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { ErrorDot, shortFilename, stripErrorXml, type ToolCardProps } from './shared';

export function ReadFileCard({ args, result, isError }: ToolCardProps) {
  const filePath = (args.file_path as string) || '';
  const rawResultText = typeof result === 'string' ? result : undefined;
  const resultText = rawResultText ? stripErrorXml(rawResultText) : undefined;

  return (
    <CollapsibleToolCard
      variant="compact"
      header={
        <>
          <Eye size={15} className="text-mf-text-secondary/40 shrink-0" />
          <span className="font-mono text-mf-text-secondary/60 truncate text-mf-body" title={filePath}>
            {shortFilename(filePath)}
          </span>
        </>
      }
      trailing={<ErrorDot isError={isError} />}
    >
      {resultText && (
        <div className="border-t border-mf-divider/50 ml-5">
          {isError ? (
            <pre className="text-mf-small font-mono overflow-x-auto whitespace-pre-wrap px-3 py-2 max-h-[300px] overflow-y-auto text-mf-chat-error-muted bg-mf-chat-error-surface/20">
              {resultText}
            </pre>
          ) : (
            <div className="font-mono text-mf-small leading-[20px] overflow-x-auto max-h-[300px] overflow-y-auto">
              {resultText.split('\n').map((line, i) => (
                <div
                  key={i}
                  className="flex border-l-2 border-l-transparent hover:bg-mf-text-primary/5 transition-colors"
                >
                  <span className="shrink-0 w-10 select-none text-mf-text-secondary opacity-30 text-right pr-2">
                    {i + 1}
                  </span>
                  <span className="text-mf-text-secondary opacity-60 whitespace-pre-wrap break-all pr-3">{line}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </CollapsibleToolCard>
  );
}
