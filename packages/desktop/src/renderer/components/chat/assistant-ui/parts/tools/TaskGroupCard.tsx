import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { ErrorDot, type ToolCardProps } from './shared';
import { renderToolCard } from './render-tool-card';

interface TaskGroupChild {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

const FRIENDLY_NAMES: Record<string, string> = {
  _ToolGroup: 'Explore',
  _TaskProgress: 'Tasks',
  _TaskGroup: 'Agent',
};

function buildSummary(children: TaskGroupChild[]): string {
  const counts = new Map<string, number>();
  for (const child of children) {
    const label = FRIENDLY_NAMES[child.toolName] ?? child.toolName;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, n]) => `${n} ${name}`).join(' · ');
}

export function TaskGroupCard({ args, isError }: ToolCardProps) {
  const [open, setOpen] = useState(false);
  const taskArgs = (args.taskArgs as Record<string, unknown>) || {};
  const children = (args.children as TaskGroupChild[]) || [];

  const agentType = (taskArgs.subagent_type as string) || 'Task';
  const model = taskArgs.model as string | undefined;
  const description = (taskArgs.description as string) || (taskArgs.prompt as string) || '';
  const truncatedDesc = description.length > 60 ? description.slice(0, 60) + '...' : description;
  const summary = buildSummary(children);

  return (
    <div className="ml-4 pl-3 border-l border-mf-divider/50 space-y-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 py-0.5 text-mf-body hover:bg-mf-hover/20 transition-colors"
      >
        <ChevronRight
          size={14}
          className={cn('text-mf-text-secondary/40 transition-transform duration-150', open && 'rotate-90')}
        />
        <span className="text-mf-body text-mf-accent font-medium">{agentType}</span>
        {model && <span className="text-mf-status text-mf-text-secondary/50 font-mono">{model}</span>}
        <span className="text-mf-small text-mf-text-secondary/70 truncate" title={description}>
          {truncatedDesc}
        </span>
        <span className="flex-1" />
        {!open && summary && <span className="text-mf-status text-mf-text-secondary/50 font-mono">{summary}</span>}
        <ErrorDot isError={isError} />
      </button>
      {open &&
        children.map((child) => (
          <React.Fragment key={child.toolCallId}>
            {renderToolCard(child.toolName, child.args, '', child.result, child.isError)}
          </React.Fragment>
        ))}
    </div>
  );
}
