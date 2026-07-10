'use client';

/**
 * WriteFileCard — tool card for the 'Write' tool.
 *
 * Collapsed by default. Header: green family tile + "Write" verb +
 * ClickableFilePath + +N stat pill + StatusDot.
 * Body: structured diff patch when available, otherwise an all-add line view.
 *
 * Native assistant-ui contract: `ToolCallMessagePartComponent`.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { PlusIcon } from 'lucide-react';
import {
  isStructuredResult,
  resolveResultText,
  countDiffStats,
  DiffFromPatch,
  ClickableFilePath,
  StatusDot,
  CollapsibleCardShell,
  FamilyTile,
} from '../shared';
import type { DiffHunk } from '@qlan-ro/mainframe-types';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId } from '../chat-tool-context';

// ---------------------------------------------------------------------------
// AllAddLines — renders every content line as an add row (no structuredPatch).
// ---------------------------------------------------------------------------

function AllAddLines({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="font-mono text-caption leading-5 overflow-x-auto bg-mf-code-bg">
      {lines.map((line, i) => (
        <div
          key={i}
          className="flex border-l-2 border-l-mf-diff-add-border bg-mf-diff-add-bg hover:brightness-95 transition-colors"
        >
          <span className="shrink-0 w-8 select-none text-mf-text-4 text-right pr-1" />
          <span className="shrink-0 w-8 select-none text-mf-text-4 text-right pr-2">{i + 1}</span>
          <span className="shrink-0 w-5 select-none text-mf-diff-add-text text-center font-bold">+</span>
          <span className="select-text whitespace-pre-wrap break-all pr-3 text-mf-diff-add-text">{line}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WriteCardBody — diff view + optional error footer
// ---------------------------------------------------------------------------

interface WriteCardBodyProps {
  hunks: DiffHunk[] | null;
  content: string;
  hasError: boolean;
  resultText: string;
  showExpand: boolean;
  chatId: string | undefined;
  toolCallId: string | undefined;
  fullBytes: number;
}

function WriteCardBody({
  hunks,
  content,
  hasError,
  resultText,
  showExpand,
  chatId,
  toolCallId,
  fullBytes,
}: WriteCardBodyProps) {
  return (
    <div className="border-t border-border">
      {hunks ? <DiffFromPatch hunks={hunks} /> : <AllAddLines content={content} />}
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
              data-testid="chat-write-error-text"
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
// WriteFileCard
// ---------------------------------------------------------------------------

export const WriteFileCard: ToolCallMessagePartComponent = (part) => {
  const { args, result, isError, toolCallId } = part;
  const chatId = useChatId();

  const filePath = (args['file_path'] as string) ?? '';
  const content = (args['content'] as string) ?? '';

  const { text: resultText, truncated, fullBytes } = resolveResultText(result);
  const structured = isStructuredResult(result);

  const hunks = structured ? (result.structuredPatch ?? null) : null;
  const stats = hunks ? countDiffStats(hunks) : null;
  const hasError = Boolean(resultText && isError);
  const showExpand = hasError && truncated && Boolean(chatId) && Boolean(toolCallId);

  const tile = (
    <FamilyTile color="var(--mf-success)" bg="var(--mf-success-tint)">
      <PlusIcon size={13} />
    </FamilyTile>
  );

  const trailing = (
    <>
      {stats?.added != null && (
        <span className="font-mono tabular-nums text-micro shrink-0 font-semibold text-mf-diff-add-text">
          +{stats.added}
        </span>
      )}
      <StatusDot result={result} isError={isError} />
    </>
  );

  const body =
    hunks || content || hasError ? (
      <WriteCardBody
        hunks={hunks}
        content={content}
        hasError={hasError}
        resultText={resultText}
        showExpand={showExpand}
        chatId={chatId}
        toolCallId={toolCallId}
        fullBytes={fullBytes}
      />
    ) : null;

  return (
    <CollapsibleCardShell
      testId="chat-write-card"
      triggerId="chat-write-trigger"
      result={result}
      isError={isError}
      defaultOpen={false}
      tile={tile}
      verb="Write"
      target={<ClickableFilePath filePath={filePath} />}
      trailing={trailing}
    >
      {body}
    </CollapsibleCardShell>
  );
};

WriteFileCard.displayName = 'WriteFileCard';
