import React from 'react';
import { ErrorDot, type ToolCardProps } from './shared';
import { renderToolCard } from './render-tool-card';

interface TaskGroupChild {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

export function TaskGroupCard({ args, result, isError }: ToolCardProps) {
  const taskArgs = (args.taskArgs as Record<string, unknown>) || {};
  const children = (args.children as TaskGroupChild[]) || [];

  const agentType = (taskArgs.subagent_type as string) || 'Task';
  const description = (taskArgs.description as string) || (taskArgs.prompt as string) || '';
  const truncatedDesc = description.length > 60 ? description.slice(0, 60) + '...' : description;

  return (
    <div className="ml-4 pl-3 border-l border-mf-divider/50 space-y-1">
      <div className="flex items-center gap-2 py-0.5 text-mf-body">
        <span className="text-mf-body text-mf-accent font-medium">{agentType}</span>
        <span className="text-mf-small text-mf-text-secondary/70 truncate" title={description}>
          {truncatedDesc}
        </span>
        <span className="flex-1" />
        <ErrorDot isError={isError} />
      </div>
      {children.map((child) => (
        <React.Fragment key={child.toolCallId}>
          {renderToolCard(child.toolName, child.args, '', child.result, child.isError)}
        </React.Fragment>
      ))}
    </div>
  );
}
