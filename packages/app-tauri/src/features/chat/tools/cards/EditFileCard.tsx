'use client';

/**
 * EditFileCard — tool card for the 'Edit' tool.
 *
 * Default-open. Header: amber family tile + "Edit" verb + ClickableFilePath
 * + +N/−N stat pills + open-in-diff icon button + StatusDot.
 * Body: structured diff patch when available, fallback hunks otherwise.
 *
 * Native assistant-ui contract: `ToolCallMessagePartComponent`.
 */
import React, { useCallback } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ExternalLinkIcon, FileDiffIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  isStructuredResult,
  resolveResultText,
  countDiffStats,
  computeFallbackHunks,
  reconstructFromHunks,
  DiffFromPatch,
  DiffFallback,
  ClickableFilePath,
  StatusDot,
  CollapsibleCardShell,
  FamilyTile,
} from '../shared';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId, useOpenFile } from '../chat-tool-context';
import type { DiffHunk } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Stat pills (+N / −N)
// ---------------------------------------------------------------------------

function StatPills({ added, removed }: { added: number | null; removed: number | null }) {
  if (added === null && removed === null) return null;
  return (
    <span className="flex items-center gap-1.5 font-mono tabular-nums text-micro shrink-0">
      {added !== null && <span className="font-semibold text-mf-diff-add-text">+{added}</span>}
      {removed !== null && <span className="font-semibold text-mf-diff-del-text">−{removed}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// OpenDiffButton
// ---------------------------------------------------------------------------

function OpenDiffButton({ onOpenDiff }: { onOpenDiff: (e: React.MouseEvent | React.KeyboardEvent) => void }) {
  return (
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
  resultText: string;
  showExpand: boolean;
  chatId: string | undefined;
  toolCallId: string | undefined;
  fullBytes: number;
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
  fullBytes,
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
              truncatedContent={resultText}
              fullBytes={fullBytes}
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
// useEditCardState
// ---------------------------------------------------------------------------

interface EditCardState {
  filePath: string;
  oldString: string;
  newString: string;
  displayHunks: DiffHunk[] | null;
  addedCount: number | null;
  removedCount: number | null;
  resultText: string;
  fullBytes: number;
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

  const { text: resultText, truncated, fullBytes } = resolveResultText(result);
  const structured = isStructuredResult(result);

  const hunks = structured ? (result.structuredPatch ?? null) : null;
  const displayHunks = hunks ?? (oldString || newString ? computeFallbackHunks(oldString, newString) : null);

  const stats = displayHunks ? countDiffStats(displayHunks) : null;
  const hasError = Boolean(resultText && isError);
  const showExpand = hasError && truncated && Boolean(chatId) && Boolean(toolCallId);

  const handleOpenDiff = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      if (structured && isStructuredResult(result) && result.originalFile && result.modifiedFile) {
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
    fullBytes,
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

  const tile = (
    <FamilyTile color="#d97706" bg="rgba(217,119,6,0.11)">
      <FileDiffIcon size={13} />
    </FamilyTile>
  );

  const trailing = (
    <>
      <StatPills added={state.addedCount} removed={state.removedCount} />
      <OpenDiffButton onOpenDiff={state.handleOpenDiff} />
      <StatusDot result={result} isError={isError} label />
    </>
  );

  const body =
    state.displayHunks || state.oldString || state.newString || state.hasError ? (
      <EditCardBody
        displayHunks={state.displayHunks}
        oldString={state.oldString}
        newString={state.newString}
        hasError={state.hasError}
        resultText={state.resultText}
        showExpand={state.showExpand}
        chatId={state.chatId}
        toolCallId={toolCallId}
        fullBytes={state.fullBytes}
      />
    ) : null;

  return (
    <CollapsibleCardShell
      testId="chat-edit-card"
      triggerId="chat-edit-trigger"
      result={result}
      isError={isError}
      defaultOpen
      tile={tile}
      verb="Edit"
      target={<ClickableFilePath filePath={state.filePath} />}
      trailing={trailing}
    >
      {body}
    </CollapsibleCardShell>
  );
};

EditFileCard.displayName = 'EditFileCard';
