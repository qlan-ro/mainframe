'use client';

/**
 * WriteFileCard — tool card for the 'Write' tool.
 *
 * Collapsed by default. Header: plus glyph + "Write" verb +
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
    <div className="overflow-x-auto bg-mf-code-bg font-mono text-xs leading-5">
      {lines.map((line, i) => (
        <div
          key={i}
          className="flex border-l-2 border-l-mf-diff-add-border bg-mf-diff-add-bg transition-colors hover:brightness-95"
        >
          <span className="w-8 shrink-0 pr-1 text-right text-muted-foreground select-none" />
          <span className="w-8 shrink-0 pr-2 text-right text-muted-foreground select-none">{i + 1}</span>
          <span className="w-5 shrink-0 text-center font-bold text-mf-diff-add-text select-none">+</span>
          <span className="pr-3 break-all whitespace-pre-wrap text-mf-diff-add-text select-text">{line}</span>
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

  const trailing = (
    <>
      {stats?.added != null && (
        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-muted-foreground">
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
      icon={<PlusIcon />}
      verb="Write"
      target={<ClickableFilePath filePath={filePath} />}
      trailing={trailing}
    >
      {body}
    </CollapsibleCardShell>
  );
};

WriteFileCard.displayName = 'WriteFileCard';
