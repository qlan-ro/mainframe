import React from 'react';
import { Maximize2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { useTabsStore } from '../../../../../store/tabs';
import { FileTypeIcon } from '../FileTypeIcon';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import {
  StatusDot,
  cardStyle,
  shortFilename,
  isStructuredResult,
  stripErrorXml,
  countDiffStats,
  reconstructFromHunks,
  DiffFromPatch,
  type ToolCardProps,
} from './shared';

export function WriteFileCard({ args, result, isError }: ToolCardProps) {
  const filePath = (args.file_path as string) || '';
  const content = (args.content as string) || '';

  const structured = isStructuredResult(result);
  const hunks = structured ? result.structuredPatch : null;
  const rawResultText = structured ? result.content : typeof result === 'string' ? result : undefined;
  const resultText = rawResultText ? stripErrorXml(rawResultText) : undefined;

  const stats = hunks ? countDiffStats(hunks) : null;
  const addedCount = stats?.added ?? null;
  const removedCount = stats?.removed ?? null;

  const startLine = hunks?.[0]?.oldStart;

  const handleOpenDiff = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (structured && result.originalFile && result.modifiedFile) {
      useTabsStore.getState().openInlineDiffTab(filePath, result.originalFile, result.modifiedFile);
    } else {
      const diffContent = hunks ? reconstructFromHunks(hunks) : { original: '', modified: content };
      useTabsStore.getState().openInlineDiffTab(filePath, diffContent.original, diffContent.modified, startLine);
    }
  };

  return (
    <CollapsibleToolCard
      wrapperClassName={cardStyle(result, isError)}
      header={
        <>
          <FileTypeIcon filePath={filePath} />
          <span className="font-mono text-mf-accent truncate text-mf-body" title={filePath}>
            {shortFilename(filePath)}
          </span>
        </>
      }
      trailing={
        <>
          {addedCount !== null && (
            <span className="flex items-center gap-1.5 text-mf-status font-mono tabular-nums">
              <span className="px-1.5 py-0.5 rounded-full bg-mf-chat-diff-added/15 text-mf-chat-diff-added-text">
                +{addedCount}
              </span>
              {removedCount ? (
                <span className="px-1.5 py-0.5 rounded-full bg-mf-chat-diff-removed/15 text-mf-chat-diff-removed-text">
                  -{removedCount}
                </span>
              ) : null}
            </span>
          )}
          <span
            onClick={handleOpenDiff}
            className="p-0.5 rounded hover:bg-mf-hover/50 text-mf-text-secondary/60 hover:text-mf-text-primary transition-colors"
            title="Open in diff editor"
          >
            <Maximize2 size={14} />
          </span>
          <StatusDot result={result} isError={isError} />
        </>
      }
    >
      <div className="border-t border-mf-divider">
        <div className="max-h-[300px] overflow-y-auto">
          {hunks ? (
            <DiffFromPatch hunks={hunks} />
          ) : (
            <div className="font-mono text-mf-small leading-[20px] overflow-x-auto">
              {content.split('\n').map((line, i) => (
                <div
                  key={i}
                  className="flex border-l-2 border-l-mf-chat-diff-added bg-mf-chat-diff-added/[8%] hover:bg-mf-chat-diff-added/[13%] transition-colors"
                >
                  <span className="shrink-0 w-8 select-none text-mf-text-secondary opacity-30 text-right pr-1"> </span>
                  <span className="shrink-0 w-8 select-none text-mf-chat-diff-added-text opacity-70 text-right pr-2">
                    {i + 1}
                  </span>
                  <span className="shrink-0 w-5 select-none text-mf-chat-diff-added-text text-center">+</span>
                  <span className="text-mf-chat-diff-added-content whitespace-pre-wrap break-all pr-3">{line}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {resultText && (
          <div className={cn('border-t border-mf-divider px-3 py-1.5', isError && 'bg-mf-chat-error-surface/20')}>
            <pre className="text-mf-small font-mono overflow-x-auto whitespace-pre-wrap text-mf-text-secondary">
              {resultText}
            </pre>
          </div>
        )}
      </div>
    </CollapsibleToolCard>
  );
}
