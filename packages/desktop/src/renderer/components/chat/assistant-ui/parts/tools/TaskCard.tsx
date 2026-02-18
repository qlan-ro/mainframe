import React from 'react';
import { ErrorDot, type ToolCardProps } from './shared';

export function TaskCard({ args, isError }: ToolCardProps) {
  const agentType = (args.subagent_type as string) || 'Task';
  const description = (args.description as string) || (args.prompt as string) || '';
  const truncatedDesc = description.length > 60 ? description.slice(0, 60) + '...' : description;

  return (
    <div className="ml-4 pl-3 border-l border-mf-divider/50">
      <div className="flex items-center gap-2 py-0.5 text-mf-body">
        <span className="text-mf-body text-mf-accent font-medium">{agentType}</span>
        <span className="text-mf-small text-mf-text-secondary/70 truncate" title={description}>
          {truncatedDesc}
        </span>
        <span className="flex-1" />
        <ErrorDot isError={isError} />
      </div>
    </div>
  );
}
