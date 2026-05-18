import { Bot } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';
import { ErrorDot, type ToolCardProps } from './shared';

const USAGE_RE =
  /<usage>\s*total_tokens:\s*(\d+)\s*(?:\\n|\n)\s*tool_uses:\s*(\d+)\s*(?:\\n|\n)\s*duration_ms:\s*(\d+)\s*<\/usage>/;

function parseAgentUsage(result: unknown): { tokens: number; toolUses: number; durationMs: number } | null {
  const text = typeof result === 'string' ? result : '';
  const match = USAGE_RE.exec(text);
  if (!match) return null;
  return { tokens: Number(match[1]), toolUses: Number(match[2]), durationMs: Number(match[3]) };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

export function TaskCard({ args, result, isError }: ToolCardProps) {
  const agentType = (args.subagent_type as string) || 'Task';
  const model = args.model as string | undefined;
  const description = (args.description as string) || (args.prompt as string) || '';
  const truncatedDesc = description.length > 80 ? description.slice(0, 80) + '…' : description;
  const usage = parseAgentUsage(result);
  const isDone = result !== undefined;
  const promptForTooltip = (() => {
    const p = String(args.prompt ?? args.description ?? '');
    if (!p) return null;
    return p.length > 600 ? p.slice(0, 600) + '…' : p;
  })();

  return (
    <div data-testid="task-card">
      <div className="flex items-center gap-2 py-0.5 text-mf-body">
        <Bot size={14} className="text-mf-accent shrink-0" />
        <span className="text-mf-body text-mf-accent font-medium">{agentType}</span>
        {model && <span className="text-mf-status text-mf-text-secondary/50 font-mono">{model}</span>}
        <span className="flex-1" />
        {!isDone && <span className="w-2 h-2 rounded-full bg-mf-text-secondary/40 animate-pulse shrink-0" />}
        {isDone && usage && (
          <span className="text-mf-status text-mf-text-secondary/50 font-mono">
            {usage.toolUses} tool uses · {formatTokens(usage.tokens)} tokens · {formatDuration(usage.durationMs)}
          </span>
        )}
        <ErrorDot isError={isError} />
      </div>
      {description &&
        (promptForTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-mf-small text-mf-text-secondary/70 truncate pl-6" tabIndex={0}>
                {truncatedDesc}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-[480px] whitespace-pre-wrap">{promptForTooltip}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="text-mf-small text-mf-text-secondary/70 truncate pl-6">{truncatedDesc}</div>
        ))}
    </div>
  );
}
