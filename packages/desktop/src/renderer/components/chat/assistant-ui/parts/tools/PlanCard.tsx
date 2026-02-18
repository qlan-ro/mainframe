import React from 'react';
import { FileText } from 'lucide-react';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { ErrorDot, stripErrorXml, type ToolCardProps } from './shared';

export function PlanCard({ result, isError }: ToolCardProps) {
  const rawResultText = typeof result === 'string' ? result : undefined;
  const resultText = rawResultText ? stripErrorXml(rawResultText) : undefined;

  return (
    <CollapsibleToolCard
      variant="compact"
      disabled={!resultText}
      header={
        <>
          <FileText size={15} className="text-mf-text-secondary/40 shrink-0" />
          <span className="text-mf-body text-mf-text-secondary/60">Updated plan</span>
        </>
      }
      trailing={<ErrorDot isError={isError} />}
    >
      {resultText && (
        <div className="ml-5 border-l border-mf-divider/50 py-1">
          <pre className="text-mf-small font-mono text-mf-text-secondary/60 whitespace-pre-wrap px-3 max-h-[200px] overflow-y-auto">
            {resultText}
          </pre>
        </div>
      )}
    </CollapsibleToolCard>
  );
}
