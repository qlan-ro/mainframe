/**
 * ReadFileCard — compact collapsible card for the 'Read' tool.
 *
 * Family: Explore (blue, #5b8def).
 * Header: file-type tile + "Read" verb + ClickableFilePath + optional "· N lines" meta.
 * Body (collapsed by default): line-numbered code preview on bg-mf-code-bg.
 *   - Truncated results → ToolResultExpand (full fetch on demand).
 *   - Error results → pre on destructive-tinted bg.
 *   - No result yet → body absent (pending state shown via StatusDot).
 *
 * Token rules: no /opacity modifier on --mf-* hex vars; status dots via StatusDot helper.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { FileTextIcon } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { ClickableFilePath, StatusDot, cardStyle, isTruncatedResult, stripErrorXml } from '../shared';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId } from '../chat-tool-context';

// ---------------------------------------------------------------------------
// Family tile
// ---------------------------------------------------------------------------

const FAMILY_COLOR = '#5b8def';
const FAMILY_BG = `${FAMILY_COLOR}1c`; // ~11% alpha tint

// ---------------------------------------------------------------------------
// Sub-components (each < 50 lines)
// ---------------------------------------------------------------------------

interface CodePreviewProps {
  text: string;
  startLine: number;
}

function CodePreview({ text, startLine }: CodePreviewProps) {
  const lines = text.split('\n');
  return (
    <div
      data-testid="read-card-code-preview"
      className="bg-mf-code-bg font-mono text-caption leading-[18px] overflow-x-auto max-h-[300px] overflow-y-auto"
    >
      {lines.map((line, i) => (
        <div key={i} className="flex min-h-[18px] hover:bg-muted transition-colors">
          <span className="shrink-0 w-9 text-right pr-3 select-none text-mf-text-4 text-micro leading-[18px]">
            {startLine + i}
          </span>
          <span className="flex-1 whitespace-pre pr-3 text-mf-code-fg">{line}</span>
        </div>
      ))}
    </div>
  );
}

function ErrorBody({ text }: { text: string }) {
  return (
    <div className="relative">
      <div className="absolute inset-0 bg-destructive opacity-10 pointer-events-none" aria-hidden />
      <pre
        data-testid="read-card-error-body"
        className="relative font-mono text-caption whitespace-pre-wrap break-words px-3 py-2 max-h-[300px] overflow-y-auto text-destructive"
      >
        {text}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadFileCard
// ---------------------------------------------------------------------------

export const ReadFileCard: ToolCallMessagePartComponent = ({ toolCallId, args, result, isError }) => {
  const chatId = useChatId();
  const filePath = typeof args['file_path'] === 'string' ? args['file_path'] : '';
  const fromLine = typeof args['from'] === 'number' ? args['from'] : 1;

  const truncated = isTruncatedResult(result);
  const rawText = typeof result === 'string' ? result : truncated ? result.content : undefined;
  const resultText = rawText ? stripErrorXml(rawText) : undefined;

  const lineCount = resultText ? resultText.split('\n').length : 0;
  const metaLabel = lineCount > 0 ? `· ${lineCount} line${lineCount !== 1 ? 's' : ''}` : undefined;
  const hasBody = resultText !== undefined;

  return (
    <Collapsible data-testid="read-card-root" defaultOpen={false} className={cn(cardStyle(result, isError), 'w-full')}>
      {/* Header */}
      <CollapsibleTrigger
        data-testid="read-card-trigger"
        disabled={!hasBody}
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-1.5',
          'text-body transition-colors hover:bg-accent',
          !hasBody && 'cursor-default',
        )}
      >
        <span
          aria-hidden
          className="flex shrink-0 items-center justify-center w-[22px] h-[22px] rounded-md"
          style={{ backgroundColor: FAMILY_BG }}
        >
          <FileTextIcon size={13} style={{ color: FAMILY_COLOR }} />
        </span>

        <span className="text-label font-semibold text-muted-foreground shrink-0">Read</span>

        {filePath && (
          <span className="min-w-0 flex-1 truncate">
            <ClickableFilePath filePath={filePath} />
          </span>
        )}

        {metaLabel && <span className="shrink-0 font-mono text-micro text-mf-text-4">{metaLabel}</span>}

        <div className="flex-1 min-w-2" />
        <StatusDot result={result} isError={isError} />
      </CollapsibleTrigger>

      {/* Body */}
      {hasBody && (
        <CollapsibleContent
          data-testid="read-card-content"
          className={cn(
            'overflow-hidden',
            'data-[state=open]:animate-collapsible-down',
            'data-[state=closed]:animate-collapsible-up',
            'data-[state=closed]:fill-mode-forwards',
          )}
        >
          <div className="border-t border-border">
            {truncated && chatId ? (
              <div className="px-3 py-2">
                <ToolResultExpand
                  chatId={chatId}
                  toolUseId={toolCallId}
                  truncatedContent={resultText ?? ''}
                  fullBytes={result.fullBytes}
                />
              </div>
            ) : isError ? (
              <ErrorBody text={resultText ?? ''} />
            ) : (
              <CodePreview text={resultText ?? ''} startLine={fromLine} />
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
};

ReadFileCard.displayName = 'ReadFileCard';
