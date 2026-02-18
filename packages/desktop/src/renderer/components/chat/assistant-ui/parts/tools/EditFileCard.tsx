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
  computeFallbackHunks,
  reconstructFromHunks,
  DiffFromPatch,
  DiffFallback,
  type ToolCardProps,
} from './shared';

export function EditFileCard({ args, result, isError }: ToolCardProps) {
  const filePath = (args.file_path as string) || '';
  const oldString = (args.old_string as string) || '';
  const newString = (args.new_string as string) || '';

  const structured = isStructuredResult(result);
  const rawResultText = structured ? result.content : typeof result === 'string' ? result : undefined;
  const resultText = rawResultText ? stripErrorXml(rawResultText) : undefined;
  const hunks = structured ? result.structuredPatch : null;
  const displayHunks = hunks ?? (oldString || newString ? computeFallbackHunks(oldString, newString) : null);

  const stats = displayHunks ? countDiffStats(displayHunks) : null;
  const addedCount = stats?.added ?? null;
  const removedCount = stats?.removed ?? null;

  const startLine = hunks?.[0]?.oldStart;

  const handleOpenDiff = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (structured && result.originalFile && result.modifiedFile) {
      useTabsStore.getState().openInlineDiffTab(filePath, result.originalFile, result.modifiedFile);
    } else {
      const diffContent = displayHunks
        ? reconstructFromHunks(displayHunks)
        : { original: oldString, modified: newString };
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
          {addedCount !== null && removedCount !== null && (
            <span className="flex items-center gap-1.5 text-mf-status font-mono tabular-nums">
              <span className="px-1.5 py-0.5 rounded-full bg-mf-chat-diff-added/15 text-mf-chat-diff-added-text">
                +{addedCount}
              </span>
              <span className="px-1.5 py-0.5 rounded-full bg-mf-chat-diff-removed/15 text-mf-chat-diff-removed-text">
                -{removedCount}
              </span>
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
          {displayHunks ? (
            <DiffFromPatch hunks={displayHunks} />
          ) : (
            <DiffFallback oldStr={oldString} newStr={newString} startLine={null} />
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
