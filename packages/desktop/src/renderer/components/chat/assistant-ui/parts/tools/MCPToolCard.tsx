import { Plug, ChevronRight, ChevronDown } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';
import { useExpandable } from './use-expandable';

interface Props {
  toolName: string;
  args: Record<string, unknown>;
  result?: { content?: string; isError?: boolean } | string;
  isError?: boolean;
}

function parseToolName(toolName: string): { server: string; tool: string } {
  const m = toolName.match(/^mcp__(.+?)__(.+)$/);
  if (!m) return { server: 'mcp', tool: toolName };
  let server = m[1]!;
  if (server.startsWith('claude_ai_')) server = server.slice('claude_ai_'.length);
  server = server.charAt(0).toUpperCase() + server.slice(1);
  return { server, tool: m[2]! };
}

export function MCPToolCard({ toolName, args, result, isError }: Props) {
  const { server, tool } = parseToolName(toolName);
  const pending = result === undefined;
  const errored = !pending && (isError || (typeof result === 'object' && result?.isError));
  const { open, toggle, ref } = useExpandable<HTMLDivElement>();
  const expandable = !pending && !errored;
  const Chevron = open ? ChevronDown : ChevronRight;

  const verb = errored ? 'failed:' : pending ? 'executing' : 'executed';
  const dot = pending ? (
    <span className="w-2 h-2 rounded-full bg-mf-text-secondary/40 animate-pulse" />
  ) : errored ? (
    <span className="w-2 h-2 rounded-full bg-mf-chat-error" />
  ) : null;

  const resultText = typeof result === 'string' ? result : (result?.content ?? '');

  return (
    <div ref={ref} className="flex flex-col items-center gap-2 my-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => expandable && toggle()}
            className={
              errored
                ? 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 border border-mf-chat-error/30'
                : 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-mf-hover/50 hover:bg-mf-hover/70 transition-colors'
            }
            disabled={!expandable}
          >
            <Plug size={12} className="text-mf-text-secondary shrink-0" />
            <span className="font-mono text-[11px] text-mf-text-secondary">
              {server} {verb} <span className="text-mf-accent">{tool}</span>
            </span>
            {dot}
            {expandable ? <Chevron size={12} className="text-mf-text-secondary/60 shrink-0" /> : null}
          </button>
        </TooltipTrigger>
        <TooltipContent>{toolName}</TooltipContent>
      </Tooltip>

      {open && expandable ? (
        <div className="w-full rounded-mf-card border border-mf-divider bg-mf-hover/20 px-3 py-2 space-y-2">
          <div>
            <span className="text-mf-status uppercase tracking-wide font-semibold text-mf-text-secondary">
              Arguments
            </span>
            <pre className="mt-1 text-mf-small font-mono text-mf-text-secondary overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          {resultText ? (
            <div>
              <span className="text-mf-status uppercase tracking-wide font-semibold text-mf-text-secondary">
                Result
              </span>
              <pre className="mt-1 text-mf-small font-mono text-mf-text-primary overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                {resultText}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
