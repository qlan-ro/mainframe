'use client';

/**
 * BashCard — tool card for the 'Bash' tool.
 *
 * Collapsed by default. Header: terminal glyph + truncated command (tooltip) +
 * optional description sub-header + StatusDot. Body: color-coded terminal
 * output on the terminal palette (bridge-owned by design — this IS terminal
 * output). ToolResultExpand for truncated results.
 *
 * BashCard's header is a full-width monospace command string (not a file path),
 * so it uses Collapsible directly rather than CollapsibleCardShell, which is
 * optimised for the glyph+verb+path pattern.
 *
 * Native assistant-ui contract: `ToolCallMessagePartComponent`.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { Terminal } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { StatusDot, cardStyle, isTruncatedResult, resolveResultText } from '../shared';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId } from '../chat-tool-context';

// ---------------------------------------------------------------------------
// Output line colorizer
// ---------------------------------------------------------------------------

function outputLineClass(line: string): string {
  const t = line.trim();
  if (t.includes('✓') || /\bpass(ed|ing)?\b/i.test(t)) return 'text-mf-term-green';
  if (t.includes('✗') || /\b(error|fail(ed|ure)?)\b/i.test(t)) return 'text-destructive';
  return 'text-mf-term-fg';
}

function ExitLine({ text }: { text: string }) {
  const match = /exit\s+(\d+)/i.exec(text);
  if (!match) return <span className="text-mf-term-fg">{text}</span>;
  const code = parseInt(match[1] ?? '0', 10);
  return <span className={code === 0 ? 'text-mf-term-green' : 'text-destructive'}>{text}</span>;
}

// ---------------------------------------------------------------------------
// TerminalBody
// ---------------------------------------------------------------------------

interface TerminalBodyProps {
  command: string;
  resultText: string;
  isError: boolean | undefined;
  chatId: string | undefined;
  toolCallId: string | undefined;
  truncated: boolean;
  fullBytes: number;
}

function TerminalBody({ command, resultText, isError, chatId, toolCallId, truncated, fullBytes }: TerminalBodyProps) {
  const lines = resultText.split('\n');

  return (
    <div className={cn('rounded-b-lg border-t border-border bg-mf-term-bg px-3 py-2', isError && 'border-destructive')}>
      {truncated && chatId && toolCallId ? (
        <ToolResultExpand chatId={chatId} toolUseId={toolCallId} truncatedContent={resultText} fullBytes={fullBytes} />
      ) : (
        <pre data-testid="chat-bash-output" className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">
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

// ---------------------------------------------------------------------------
// BashCard
// ---------------------------------------------------------------------------

export const BashCard: ToolCallMessagePartComponent = (part) => {
  const { args, result, isError, toolCallId } = part;
  const chatId = useChatId();

  const command = (args['command'] as string | undefined) ?? (args['input'] as string | undefined) ?? '';
  const description = args['description'] as string | undefined;

  const { text: resultText, fullBytes } = resolveResultText(result);
  const hasOutput = Boolean(resultText);
  // A running command (no result yet) is expandable too, so the streaming
  // output — and the full command — are visible mid-run, not only once it
  // finishes (#208).
  const isRunning = result === undefined;
  const canExpand = hasOutput || isRunning;

  return (
    <Collapsible data-testid="chat-bash-card" defaultOpen={false}>
      <div className={cn(cardStyle(result, isError))}>
        <CollapsibleTrigger
          data-testid="chat-bash-trigger"
          disabled={!canExpand}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left',
            'transition-colors hover:bg-muted',
            !canExpand && 'cursor-default',
          )}
        >
          <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-testid="chat-bash-command"
                className="min-w-0 flex-1 truncate font-mono text-sm text-foreground"
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

        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                data-testid="chat-bash-description"
                className="-mt-0.5 truncate px-3 pb-1.5 pl-[calc(0.75rem+0.875rem+0.5rem)] text-xs text-muted-foreground"
                tabIndex={0}
              >
                {description}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">{description}</TooltipContent>
          </Tooltip>
        )}

        {canExpand && (
          <CollapsibleContent>
            <TerminalBody
              command={command}
              resultText={resultText}
              isError={isError}
              chatId={chatId}
              toolCallId={toolCallId}
              truncated={isTruncatedResult(result)}
              fullBytes={fullBytes}
            />
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
};

BashCard.displayName = 'BashCard';
