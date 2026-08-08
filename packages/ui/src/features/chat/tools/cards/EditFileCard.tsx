'use client';

/**
 * EditFileCard — tool card for the 'Edit' tool.
 *
 * Default-open. Header: diff glyph + "Edit" verb + ClickableFilePath
 * + +N/−N stat pills + open-in-diff icon button + StatusDot.
 * Body: structured diff patch when available, fallback hunks otherwise,
 * raw result text when neither parses, or a "diff unavailable" notice.
 *
 * Native assistant-ui contract: `ToolCallMessagePartComponent`.
 */
import React, { useCallback } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ExternalLinkIcon, FileDiffIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
      {added !== null && <span className="font-semibold">+{added}</span>}
      {removed !== null && <span className="font-semibold">−{removed}</span>}
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
        {/* A span, not a <button>: it is nested inside the CollapsibleTrigger's
            own button, so `asChild` keeps the v2 Button chrome without invalid
            nested-button HTML. */}
        <Button
          asChild
          variant="ghost"
          size="icon-2xs"
          data-testid="chat-edit-open-diff"
          aria-label="Open in diff editor"
        >
          <span
            role="button"
            tabIndex={0}
            onClick={onOpenDiff}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenDiff(e);
              }
            }}
          >
            <ExternalLinkIcon />
          </span>
        </Button>
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
      {displayHunks ? (
        <DiffFromPatch hunks={displayHunks} />
      ) : (
        <DiffFallback oldStr={oldString} newStr={newString} startLine={null} />
      )}
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
              className="overflow-x-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground"
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
// DiffUnavailableBody — fallback when no structured/fallback diff and no error
// ---------------------------------------------------------------------------

function RawResultTextBody({ text }: { text: string }) {
  return (
    <pre
      data-testid="edit-card-diff-raw"
      className="overflow-x-auto border-t border-border px-3 py-1.5 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
    >
      {text}
    </pre>
  );
}

function DiffUnavailableBody() {
  return (
    <div
      data-testid="edit-card-diff-unavailable"
      className="border-t border-border px-3 py-1.5 text-xs italic text-muted-foreground"
    >
      Diff unavailable
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
  const { openDiff } = useOpenFile();

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
        openDiff(filePath, result.originalFile, result.modifiedFile);
        return;
      }
      const { original, modified } = displayHunks
        ? reconstructFromHunks(displayHunks)
        : { original: oldString, modified: newString };
      openDiff(filePath, original, modified);
    },
    [structured, result, filePath, displayHunks, oldString, newString, openDiff],
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

  const trailing = (
    <>
      <StatPills added={state.addedCount} removed={state.removedCount} />
      <OpenDiffButton onOpenDiff={state.handleOpenDiff} />
      <StatusDot result={result} isError={isError} />
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
    ) : state.resultText.trim() ? (
      <RawResultTextBody text={state.resultText} />
    ) : (
      <DiffUnavailableBody />
    );

  return (
    <CollapsibleCardShell
      testId="chat-edit-card"
      triggerId="chat-edit-trigger"
      result={result}
      isError={isError}
      defaultOpen
      icon={<FileDiffIcon />}
      verb="Edit"
      target={<ClickableFilePath filePath={state.filePath} />}
      trailing={trailing}
    >
      {body}
    </CollapsibleCardShell>
  );
};

EditFileCard.displayName = 'EditFileCard';
