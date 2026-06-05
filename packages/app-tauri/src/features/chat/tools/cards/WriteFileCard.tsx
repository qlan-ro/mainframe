'use client';

/**
 * WriteFileCard — tool card for the 'Write' tool.
 *
 * Collapsed by default. Header: family tile (green #28a745) + verb 'Write' +
 * ClickableFilePath + +N stat pill + StatusDot. Body: structured diff patch
 * when available, otherwise an all-add per-line view of args.content.
 *
 * Native assistant-ui contract: `ToolCallMessagePartComponent`. Receives the
 * full part props; reads `args`, `result`, `isError`, `toolCallId` directly.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  isStructuredResult,
  isTruncatedResult,
  stripErrorXml,
  countDiffStats,
  DiffFromPatch,
  ClickableFilePath,
  StatusDot,
  cardStyle,
} from '../shared';
import type { TruncatedResult } from '../shared';
import type { DiffHunk } from '@qlan-ro/mainframe-types';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId } from '../chat-tool-context';

// ---------------------------------------------------------------------------
// Family tile (22×22 green square)
// ---------------------------------------------------------------------------

function WriteFamilyTile() {
  return (
    <span
      aria-hidden
      className="w-[22px] h-[22px] rounded-md shrink-0 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(40,167,69,0.10)' }}
    >
      <span className="text-[13px] font-bold leading-none select-none" style={{ color: '#28a745' }}>
        +
      </span>
    </span>
  );
}

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
  resultText: string | undefined;
  showExpand: boolean;
  chatId: string | undefined;
  toolCallId: string | undefined;
  result: unknown;
}

function WriteCardBody({
  hunks,
  content,
  hasError,
  resultText,
  showExpand,
  chatId,
  toolCallId,
  result,
}: WriteCardBodyProps) {
  return (
    <div className="border-t border-border">
      <div className="max-h-[300px] overflow-y-auto">
        {hunks ? <DiffFromPatch hunks={hunks} /> : <AllAddLines content={content} />}
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
// useWriteCardState — derives all display state from the part props
// ---------------------------------------------------------------------------

interface WriteCardState {
  filePath: string;
  content: string;
  hunks: DiffHunk[] | null;
  addedCount: number | null;
  resultText: string | undefined;
  hasError: boolean;
  showExpand: boolean;
  chatId: string | undefined;
}

function useWriteCardState(
  args: Record<string, unknown>,
  result: unknown,
  isError: boolean | undefined,
  toolCallId: string | undefined,
): WriteCardState {
  const chatId = useChatId();

  const filePath = (args['file_path'] as string) ?? '';
  const content = (args['content'] as string) ?? '';

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
  const stats = hunks ? countDiffStats(hunks) : null;
  const hasError = Boolean(resultText && isError);
  const showExpand = hasError && truncated && Boolean(chatId) && Boolean(toolCallId);

  return { filePath, content, hunks, addedCount: stats?.added ?? null, resultText, hasError, showExpand, chatId };
}

// ---------------------------------------------------------------------------
// WriteFileCard
// ---------------------------------------------------------------------------

export const WriteFileCard: ToolCallMessagePartComponent = (part) => {
  const { args, result, isError, toolCallId } = part;
  const state = useWriteCardState(args, result, isError, toolCallId);

  return (
    <Collapsible defaultOpen={false} className={cn(cardStyle(result, isError), 'w-full')} data-testid="chat-write-card">
      <CollapsibleTrigger
        data-testid="chat-write-trigger"
        className="flex w-full items-center gap-2 px-3 py-[7px] cursor-pointer select-none hover:bg-accent transition-colors"
      >
        <WriteFamilyTile />
        <span className="text-label font-semibold text-muted-foreground shrink-0">Write</span>
        <ClickableFilePath filePath={state.filePath} />
        <span className="flex-1 min-w-0" />
        {state.addedCount !== null && (
          <span className="font-mono tabular-nums text-caption shrink-0 px-1.5 py-0.5 rounded-full bg-mf-diff-add-bg text-mf-diff-add-text font-semibold">
            +{state.addedCount}
          </span>
        )}
        <StatusDot result={result} isError={isError} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <WriteCardBody
          hunks={state.hunks}
          content={state.content}
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

WriteFileCard.displayName = 'WriteFileCard';
