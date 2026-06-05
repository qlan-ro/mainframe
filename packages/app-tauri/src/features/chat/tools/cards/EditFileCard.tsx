'use client';

/**
 * EditFileCard — tool card for the 'Edit' tool.
 *
 * Default-open. Header: family tile (amber #d97706) + verb + ClickableFilePath
 * + +N/−N stat pills + open-in-diff icon button + StatusDot. Body: structured
 * diff patch when available, fallback hunks otherwise.
 *
 * Native assistant-ui contract: `ToolCallMessagePartComponent`. Receives the
 * full part props; reads `args`, `result`, `isError`, `toolCallId` directly.
 */
import React, { useCallback } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ExternalLinkIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  isStructuredResult,
  isTruncatedResult,
  stripErrorXml,
  countDiffStats,
  computeFallbackHunks,
  reconstructFromHunks,
  DiffFromPatch,
  DiffFallback,
  ClickableFilePath,
  StatusDot,
  cardStyle,
} from '../shared';
import type { TruncatedResult } from '../shared';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId, useOpenFile } from '../chat-tool-context';
import type { DiffHunk } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Family tile (22×22 amber square)
// ---------------------------------------------------------------------------

function EditFamilyTile() {
  return (
    <span
      aria-hidden
      className="w-[22px] h-[22px] rounded-md shrink-0 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(217,119,6,0.11)' }}
    >
      <span className="text-[11px] font-bold leading-none select-none" style={{ color: '#d97706' }}>
        ±
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stat pills (+N / −N)
// ---------------------------------------------------------------------------

function StatPills({ added, removed }: { added: number | null; removed: number | null }) {
  if (added === null && removed === null) return null;
  return (
    <span className="flex items-center gap-1 font-mono tabular-nums text-caption shrink-0">
      {added !== null && (
        <span className="px-1.5 py-0.5 rounded-full bg-mf-diff-add-bg text-mf-diff-add-text font-semibold">
          +{added}
        </span>
      )}
      {removed !== null && (
        <span className="px-1.5 py-0.5 rounded-full bg-mf-diff-del-bg text-mf-diff-del-text font-semibold">
          −{removed}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// EditCardBody — diff view + optional error footer
// ---------------------------------------------------------------------------

interface EditCardBodyProps {
  displayHunks: DiffHunk[] | null;
  oldString: string;
  newString: string;
  hasError: boolean;
  resultText: string | undefined;
  showExpand: boolean;
  chatId: string | undefined;
  toolCallId: string | undefined;
  result: unknown;
}

function EditCardBody({
  displayHunks,
  oldString,
  newString,
  hasError,
  resultText,
  showExpand,
  chatId,
  toolCallId,
  result,
}: EditCardBodyProps) {
  return (
    <div className="border-t border-border">
      <div className="max-h-[300px] overflow-y-auto">
        {displayHunks ? (
          <DiffFromPatch hunks={displayHunks} />
        ) : (
          <DiffFallback oldStr={oldString} newStr={newString} startLine={null} />
        )}
      </div>
      {hasError && (
        <div className="border-t border-border px-3 py-1.5 bg-mf-diff-del-bg">
          {showExpand ? (
            <ToolResultExpand
              chatId={chatId!}
              toolUseId={toolCallId!}
              truncatedContent={resultText!}
              fullBytes={(result as TruncatedResult).fullBytes}
            />
          ) : (
            <pre
              data-testid="chat-edit-error-text"
              className="text-caption font-mono overflow-x-auto whitespace-pre-wrap text-muted-foreground"
            >
              {resultText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditCardHeader — trigger row with file tile, path, stats, diff-open button
// ---------------------------------------------------------------------------

interface EditCardHeaderProps {
  filePath: string;
  addedCount: number | null;
  removedCount: number | null;
  result: unknown;
  isError: boolean | undefined;
  onOpenDiff: (e: React.MouseEvent | React.KeyboardEvent) => void;
}

function EditCardHeader({ filePath, addedCount, removedCount, result, isError, onOpenDiff }: EditCardHeaderProps) {
  return (
    <CollapsibleTrigger
      data-testid="chat-edit-trigger"
      className="flex w-full items-center gap-2 px-3 py-[7px] cursor-pointer select-none hover:bg-accent transition-colors"
    >
      <EditFamilyTile />
      <span className="text-label font-semibold text-muted-foreground shrink-0">Edit</span>
      <ClickableFilePath filePath={filePath} />
      <span className="flex-1 min-w-0" />
      <StatPills added={addedCount} removed={removedCount} />
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="chat-edit-open-diff"
            role="button"
            tabIndex={0}
            aria-label="Open in diff editor"
            onClick={onOpenDiff}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenDiff(e);
              }
            }}
            className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ExternalLinkIcon size={13} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">Open in diff editor</TooltipContent>
      </Tooltip>
      <StatusDot result={result} isError={isError} />
    </CollapsibleTrigger>
  );
}

// ---------------------------------------------------------------------------
// useEditCardState — derives all display state from the part props
// ---------------------------------------------------------------------------

interface EditCardState {
  filePath: string;
  oldString: string;
  newString: string;
  displayHunks: DiffHunk[] | null;
  addedCount: number | null;
  removedCount: number | null;
  resultText: string | undefined;
  hasError: boolean;
  showExpand: boolean;
  chatId: string | undefined;
  handleOpenDiff: (e: React.MouseEvent | React.KeyboardEvent) => void;
}

function useEditCardState(
  args: Record<string, unknown>,
  result: unknown,
  isError: boolean | undefined,
  toolCallId: string | undefined,
): EditCardState {
  const chatId = useChatId();
  const { openFile } = useOpenFile();

  const filePath = (args['file_path'] as string) ?? '';
  const oldString = (args['old_string'] as string) ?? '';
  const newString = (args['new_string'] as string) ?? '';

  const structured = isStructuredResult(result);
  const truncated = isTruncatedResult(result);

  const rawText = structured
    ? result.content
    : truncated
      ? result.content
      : typeof result === 'string'
        ? result
        : undefined;
  const resultText = rawText ? stripErrorXml(rawText) : undefined;

  const hunks = structured ? (result.structuredPatch ?? null) : null;
  const displayHunks = hunks ?? (oldString || newString ? computeFallbackHunks(oldString, newString) : null);

  const stats = displayHunks ? countDiffStats(displayHunks) : null;
  const hasError = Boolean(resultText && isError);
  const showExpand = hasError && truncated && Boolean(chatId) && Boolean(toolCallId);

  const handleOpenDiff = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      if (structured && result.originalFile && result.modifiedFile) {
        openFile(filePath);
        return;
      }
      const { original, modified } = displayHunks
        ? reconstructFromHunks(displayHunks)
        : { original: oldString, modified: newString };
      openFile(`${filePath}#diff&original=${encodeURIComponent(original)}&modified=${encodeURIComponent(modified)}`);
    },
    [structured, result, filePath, displayHunks, oldString, newString, openFile],
  );

  return {
    filePath,
    oldString,
    newString,
    displayHunks,
    addedCount: stats?.added ?? null,
    removedCount: stats?.removed ?? null,
    resultText,
    hasError,
    showExpand,
    chatId,
    handleOpenDiff,
  };
}

// ---------------------------------------------------------------------------
// EditFileCard
// ---------------------------------------------------------------------------

export const EditFileCard: ToolCallMessagePartComponent = (part) => {
  const { args, result, isError, toolCallId } = part;
  const state = useEditCardState(args, result, isError, toolCallId);

  return (
    <Collapsible defaultOpen className={cn(cardStyle(result, isError), 'w-full')} data-testid="chat-edit-card">
      <EditCardHeader
        filePath={state.filePath}
        addedCount={state.addedCount}
        removedCount={state.removedCount}
        result={result}
        isError={isError}
        onOpenDiff={state.handleOpenDiff}
      />
      <CollapsibleContent>
        <EditCardBody
          displayHunks={state.displayHunks}
          oldString={state.oldString}
          newString={state.newString}
          hasError={state.hasError}
          resultText={state.resultText}
          showExpand={state.showExpand}
          chatId={state.chatId}
          toolCallId={toolCallId}
          result={result}
        />
      </CollapsibleContent>
    </Collapsible>
  );
};

EditFileCard.displayName = 'EditFileCard';
