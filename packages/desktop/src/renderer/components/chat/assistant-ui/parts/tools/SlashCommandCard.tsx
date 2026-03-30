import { Zap } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';

export function SlashCommandCard({ args }: { args: Record<string, unknown> }) {
  const skill = (args.skill as string) || '';
  const skillArgs = (args.args as string) || '';

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <Zap size={14} className="text-mf-accent shrink-0" />
      <span className="font-mono text-mf-body text-mf-accent">/{skill}</span>
      {skillArgs && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-mf-small text-mf-text-secondary/60 truncate" tabIndex={0}>
              {skillArgs}
            </span>
          </TooltipTrigger>
          <TooltipContent>{skillArgs}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
