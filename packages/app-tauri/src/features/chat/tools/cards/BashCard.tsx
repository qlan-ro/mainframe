'use client';

/**
 * BashCard — tool card for the 'Bash' tool.
 *
 * Renders a collapsed terminal card with:
 *   - Terminal icon + monospace command in header
 *   - Optional description sub-header
 *   - StatusDot trailing indicator
 *   - Collapsible terminal output body (bg-mf-term-bg surface)
 *   - Color-coded output lines (green for success, amber for warnings, cmt for rest)
 *   - ToolResultExpand for truncated daemon results
 */

import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { Terminal } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { StatusDot, cardStyle, isTruncatedResult, stripErrorXml } from '../shared';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId } from '../chat-tool-context';

// ── Output line colorizer ─────────────────────────────────────────────────────

/** Maps a single output line to a Tailwind color class. */
function outputLineClass(line: string): string {
  const trimmed = line.trim();
  if (trimmed.includes('✓') || /\bpass(ed|ing)?\b/i.test(trimmed)) {
    return 'text-mf-term-green';
  }
  if (trimmed.includes('✗') || /\b(error|fail(ed|ure)?)\b/i.test(trimmed)) {
    return 'text-mf-term-amber';
  }
  return 'text-mf-term-cmt';
}

// ── Exit-code line ────────────────────────────────────────────────────────────

function ExitLine({ text }: { text: string }) {
  const match = /exit\s+(\d+)/i.exec(text);
  if (!match) return <span className="text-mf-term-cmt">{text}</span>;
  const code = parseInt(match[1] ?? '0', 10);
  return <span className={code === 0 ? 'text-mf-term-green' : 'text-destructive'}>{text}</span>;
}

// ── Terminal body ─────────────────────────────────────────────────────────────

interface TerminalBodyProps {
  command: string;
  resultText: string;
  isError: boolean | undefined;
  chatId: string | undefined;
  toolCallId: string | undefined;
  rawResult: unknown;
}

function TerminalBody({ command, resultText, isError, chatId, toolCallId, rawResult }: TerminalBodyProps) {
  const truncated = isTruncatedResult(rawResult);
  const lines = resultText.split('\n');

  return (
    <div className={cn('border-t border-border rounded-b-lg px-3 py-2 bg-mf-term-bg', isError && 'border-destructive')}>
      {truncated && chatId && toolCallId ? (
        <ToolResultExpand
          chatId={chatId}
          toolUseId={toolCallId}
          truncatedContent={resultText}
          fullBytes={(rawResult as { fullBytes: number }).fullBytes}
        />
      ) : (
        <pre
          data-testid="chat-bash-output"
          className="font-mono text-caption overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto"
        >
          {/* Prompt line */}
          <span className="text-mf-term-green">$ </span>
          <span className="text-mf-term-fg">{command}</span>
          {'\n'}
          {lines.map((line, i) => {
            const isLast = i === lines.length - 1;
            if (isLast && /^exit\s+\d+/i.test(line.trim())) {
              return (
                <span key={i}>
                  <ExitLine text={line} />
                  {'\n'}
                </span>
              );
            }
            return (
              <span key={i} className={outputLineClass(line)}>
                {line}
                {'\n'}
              </span>
            );
          })}
        </pre>
      )}
    </div>
  );
}

// ── BashCard ──────────────────────────────────────────────────────────────────

export const BashCard: ToolCallMessagePartComponent = (part) => {
  const { args, result, isError, toolCallId } = part;
  const chatId = useChatId();

  const command = (args['command'] as string | undefined) ?? (args['input'] as string | undefined) ?? '';
  const description = args['description'] as string | undefined;

  const rawResultText =
    typeof result === 'string'
      ? result
      : isTruncatedResult(result)
        ? result.content
        : result !== undefined
          ? JSON.stringify(result, null, 2)
          : undefined;

  const resultText = rawResultText ? stripErrorXml(rawResultText) : undefined;
  const hasOutput = Boolean(resultText);

  return (
    <Collapsible data-testid="chat-bash-card" defaultOpen={false}>
      <div className={cn(cardStyle(result, isError), 'group')}>
        {/* Header trigger */}
        <CollapsibleTrigger
          data-testid="chat-bash-trigger"
          disabled={!hasOutput}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left',
            'hover:bg-accent transition-colors',
            !hasOutput && 'cursor-default',
          )}
        >
          {/* Bash family icon — #7a7a82 as inline style (non-token hex) */}
          <Terminal size={15} className="shrink-0" style={{ color: '#7a7a82' }} />
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-testid="chat-bash-command"
                className="font-mono text-body text-foreground truncate min-w-0 flex-1"
                tabIndex={0}
              >
                {command}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[40ch] break-all">
              {command}
            </TooltipContent>
          </Tooltip>
          <StatusDot result={result} isError={isError} />
        </CollapsibleTrigger>

        {/* Optional description sub-header */}
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                data-testid="chat-bash-description"
                className="px-3 pb-1.5 -mt-0.5 text-caption text-muted-foreground truncate pl-9"
                tabIndex={0}
              >
                {description}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">{description}</TooltipContent>
          </Tooltip>
        )}

        {/* Collapsible output */}
        {hasOutput && resultText && (
          <CollapsibleContent>
            <TerminalBody
              command={command}
              resultText={resultText}
              isError={isError}
              chatId={chatId}
              toolCallId={toolCallId}
              rawResult={result}
            />
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
};

BashCard.displayName = 'BashCard';
