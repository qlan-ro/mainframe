import React, { useState } from 'react';
import { Bot, Maximize2, Minimize2 } from 'lucide-react';
import { ErrorDot, type ToolCardProps } from './shared';
import { renderToolCard } from './render-tool-card';

interface TaskGroupChild {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

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
  const [open, setOpen] = useState(false);
  const taskArgs = (args.taskArgs as Record<string, unknown>) || {};
  const children = (args.children as TaskGroupChild[]) || [];
  const rawResult =
    typeof result === 'object' && result !== null && 'content' in result
      ? (result as { content: string }).content
      : undefined;
  // Strip CLI metadata: <usage> block and agentId continuation hint
  const resultText =
    rawResult
      ?.replace(/<usage>[\s\S]*<\/usage>\s*$/m, '')
      .replace(/agentId:.*\(use SendMessage.*?\)\s*$/m, '')
      .trimEnd() || undefined;

  const agentType = (taskArgs.subagent_type as string) || 'Task';
  const model = taskArgs.model as string | undefined;
  const description = (taskArgs.description as string) || (taskArgs.prompt as string) || '';
  const truncatedDesc = description.length > 60 ? description.slice(0, 60) + '...' : description;
  const summary = buildSummary(children);

  return (
    <div className="space-y-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 py-0.5 text-mf-body hover:bg-mf-hover/20 transition-colors"
      >
        <Bot size={14} className="text-mf-accent shrink-0" />
        <span className="text-mf-body text-mf-accent font-medium">{agentType}</span>
        {model && <span className="text-mf-status text-mf-text-secondary/50 font-mono">{model}</span>}
        <span className="text-mf-small text-mf-text-secondary/70 truncate" title={description}>
          {truncatedDesc}
        </span>
        <span className="flex-1" />
        {summary && <span className="text-mf-status text-mf-text-secondary/50 font-mono">{summary}</span>}
        <ErrorDot isError={isError} />
        {open ? (
          <Minimize2
            size={14}
            className="p-0.5 rounded hover:bg-mf-hover/50 text-mf-text-secondary/60 hover:text-mf-text-primary transition-colors shrink-0"
          />
        ) : (
          <Maximize2
            size={14}
            className="p-0.5 rounded hover:bg-mf-hover/50 text-mf-text-secondary/60 hover:text-mf-text-primary transition-colors shrink-0"
          />
        )}
      </button>
      {open && (
        <>
          {children.map((child) => (
            <React.Fragment key={child.toolCallId}>
              {renderToolCard(child.toolName, child.args, '', child.result, child.isError)}
            </React.Fragment>
          ))}
          {resultText && (
            <div className="pl-6 text-mf-small text-mf-text-secondary whitespace-pre-wrap">{resultText}</div>
          )}
        </>
      )}
    </div>
  );
}
