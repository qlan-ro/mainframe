import React from 'react';
import { Bot } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';
import { ErrorDot, type ToolCardProps } from './shared';
import { renderToolCard } from './render-tool-card';
import { SkillLoadedCard } from './SkillLoadedCard';
import { useExpandable } from './use-expandable';

type ToolChild = {
  kind: 'tool';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
};
type TextChild = { kind: 'text'; text: string };
type ThinkingChild = { kind: 'thinking'; thinking: string };
type SkillChild = { kind: 'skill_loaded'; skillName: string; path: string; content: string };
type ImageChild = { kind: 'image'; mediaType: string; data: string };
type TaskGroupChild = ToolChild | TextChild | ThinkingChild | SkillChild | ImageChild;

interface ToolGroupItem {
  toolName: string;
}

const TOOL_LABELS: Record<string, string> = {
  Read: 'Read',
  Grep: 'Searched',
  Glob: 'Globbed',
  LS: 'Listed',
};

function buildSummary(children: TaskGroupChild[]): string {
  const counts = new Map<string, number>();
  for (const child of children) {
    if (child.kind !== 'tool') continue;
    if (child.toolName === '_ToolGroup') {
      const items = (child.args.items as ToolGroupItem[]) || [];
      for (const item of items) {
        const label = TOOL_LABELS[item.toolName] ?? item.toolName;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    } else if (child.toolName === '_TaskProgress' || child.toolName === '_TaskGroup') {
      continue;
    } else {
      const label = TOOL_LABELS[child.toolName] ?? child.toolName;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, n]) => {
      if (label === 'Read') return `Read ${n} file${n > 1 ? 's' : ''}`;
      if (label === 'Searched') return `Searched ${n} pattern${n > 1 ? 's' : ''}`;
      if (label === 'Globbed') return `Globbed ${n} pattern${n > 1 ? 's' : ''}`;
      if (label === 'Listed') return `Listed ${n} dir${n > 1 ? 's' : ''}`;
      return `${n} ${label}`;
    })
    .join(' · ');
}

export function TaskGroupCard({ args, result, isError }: ToolCardProps) {
  const { open, toggle, ref } = useExpandable<HTMLDivElement>();
  const taskArgs = (args.taskArgs as Record<string, unknown>) || {};
  const children = (args.children as TaskGroupChild[]) || [];
  const rawResult =
    typeof result === 'object' && result !== null && 'content' in result
      ? (result as { content: string }).content
      : undefined;
  const resultText =
    rawResult
      ?.replace(/<usage>[\s\S]*<\/usage>\s*$/m, '')
      .replace(/agentId:.*\(use SendMessage.*?\)\s*$/m, '')
      .trimEnd() || undefined;

  const agentType = (taskArgs.subagent_type as string) || 'Task';
  const model = taskArgs.model as string | undefined;
  const description = (taskArgs.description as string) || (taskArgs.prompt as string) || '';
  const prompt = (taskArgs.prompt as string) || '';
  const truncatedDesc = description.length > 60 ? description.slice(0, 60) + '...' : description;
  const summary = buildSummary(children);

  // Dedupe: if the FIRST text child equals taskArgs.prompt, skip rendering it
  // because we render the prompt as the intro line at the top of the body.
  const firstTextIdx = children.findIndex((c) => c.kind === 'text');
  const promptDuplicateIdx =
    firstTextIdx >= 0 && (children[firstTextIdx] as TextChild).text.trim() === prompt.trim() ? firstTextIdx : -1;

  return (
    <div ref={ref} className="space-y-1">
      <button
        onClick={() => toggle()}
        className="w-full flex items-center gap-2 py-0.5 text-mf-body hover:bg-mf-hover/20 transition-colors"
      >
        <Bot size={14} className="text-mf-accent shrink-0" />
        <span className="text-mf-body text-mf-accent font-medium">{agentType}</span>
        {model && <span className="text-mf-status text-mf-text-secondary/50 font-mono">{model}</span>}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-mf-small text-mf-text-secondary/70 truncate" tabIndex={0}>
              {truncatedDesc}
            </span>
          </TooltipTrigger>
          <TooltipContent>{description}</TooltipContent>
        </Tooltip>
        <span className="flex-1" />
        {summary && <span className="text-mf-status text-mf-text-secondary/50 font-mono">{summary}</span>}
        <ErrorDot isError={isError} />
      </button>
      {open && (
        <>
          {prompt && (
            <div className="pl-6 pr-2 pb-1 text-mf-small text-mf-text-secondary/70 italic whitespace-pre-wrap select-text">
              {prompt}
            </div>
          )}
          {children.map((child, idx) => {
            if (idx === promptDuplicateIdx) return null;
            if (child.kind === 'tool') {
              return (
                <React.Fragment key={`tool-${child.toolCallId}`}>
                  {renderToolCard(child.toolName, child.args, '', child.result, child.isError)}
                </React.Fragment>
              );
            }
            if (child.kind === 'text') {
              return (
                <div
                  key={`text-${idx}`}
                  className="pl-6 pr-2 py-1 text-mf-body text-mf-text-primary whitespace-pre-wrap select-text"
                >
                  {child.text}
                </div>
              );
            }
            if (child.kind === 'thinking') {
              return (
                <details key={`think-${idx}`} className="pl-6 pr-2 py-1 text-mf-small text-mf-text-secondary">
                  <summary className="cursor-pointer">Reasoning</summary>
                  <div className="whitespace-pre-wrap pl-3 pt-1">{child.thinking}</div>
                </details>
              );
            }
            if (child.kind === 'skill_loaded') {
              return (
                <div key={`skill-${idx}`} className="pl-6">
                  <SkillLoadedCard skillName={child.skillName} path={child.path} content={child.content} />
                </div>
              );
            }
            // image: skip for now (not surfaced in task card today)
            return null;
          })}
          {resultText && (
            <div className="pl-6 text-mf-small text-mf-text-secondary whitespace-pre-wrap select-text">
              {resultText}
            </div>
          )}
        </>
      )}
    </div>
  );
}
