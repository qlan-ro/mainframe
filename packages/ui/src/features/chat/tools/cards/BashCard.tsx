'use client';

/**
 * BashCard — tool card for the 'Bash' tool.
 *
 * Collapsed by default. Header: terminal icon + truncated command (tooltip) +
 * optional description sub-header + StatusDot. Body: color-coded terminal
 * output on bg-mf-term-bg. ToolResultExpand for truncated results.
 *
 * BashCard's header is a full-width monospace command string (not a file path),
 * so it uses Collapsible directly rather than CollapsibleCardShell which is
 * optimised for the tile+verb+path pattern.
 *
 * Native assistant-ui contract: `ToolCallMessagePartComponent`.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { Terminal } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { StatusDot, cardStyle, isTruncatedResult, resolveResultText } from '../shared';
import { FamilyTile } from '../shared/card-shell';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId } from '../chat-tool-context';

// ---------------------------------------------------------------------------
// Output line colorizer
// ---------------------------------------------------------------------------

function outputLineClass(line: string): string {
  const t = line.trim();
  if (t.includes('✓') || /\bpass(ed|ing)?\b/i.test(t)) return 'text-mf-term-green';
  if (t.includes('✗') || /\b(error|fail(ed|ure)?)\b/i.test(t)) return 'text-destructive';
  return 'text-mf-term-cmt';
}

function ExitLine({ text }: { text: string }) {
  const match = /exit\s+(\d+)/i.exec(text);
  if (!match) return <span className="text-mf-term-cmt">{text}</span>;
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
    <div className={cn('border-t border-border rounded-b-lg px-3 py-2 bg-mf-term-bg', isError && 'border-destructive')}>
      {truncated && chatId && toolCallId ? (
        <ToolResultExpand chatId={chatId} toolUseId={toolCallId} truncatedContent={resultText} fullBytes={fullBytes} />
      ) : (
        <pre data-testid="chat-bash-output" className="font-mono text-caption overflow-x-auto whitespace-pre-wrap">
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

  return (
    <Collapsible data-testid="chat-bash-card" defaultOpen={false}>
      <div className={cn(cardStyle(result, isError))}>
        <CollapsibleTrigger
          data-testid="chat-bash-trigger"
          disabled={!hasOutput}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-[7px] text-left',
            'hover:bg-accent transition-colors',
            !hasOutput && 'cursor-default',
          )}
        >
          <FamilyTile color="var(--mf-tool-bash)" bg="var(--mf-tool-bash-tint)">
            <Terminal size={13} />
          </FamilyTile>
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

        {hasOutput && (
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
