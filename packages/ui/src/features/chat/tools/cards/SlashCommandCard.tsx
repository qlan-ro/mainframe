/**
 * SlashCommandCard — inline row for the 'Skill' tool (slash-command invocation).
 *
 * Registry key: 'Skill'.
 * NOT a centered pill — an inline row in the message flow (no MarkerWrap).
 *
 *   - Zap icon + '/{skill}' in font-mono text-primary.
 *   - Optional args (truncated, tooltip on hover).
 *   - No collapse, no result display.
 *   - data-testid="chat-slash-command-row".
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ZapIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@v2/components/ui/tooltip';

export const SlashCommandCard: ToolCallMessagePartComponent = ({ args }) => {
  const skill = typeof args['skill'] === 'string' ? args['skill'] : '';
  const skillArgs = typeof args['args'] === 'string' ? args['args'] : '';

  return (
    <div data-testid="chat-slash-command-row" className="my-1 flex items-center gap-1.5 py-0.5">
      <ZapIcon className="size-3.5 shrink-0 text-primary" />
      <span className="font-mono text-sm text-primary">/{skill}</span>
      {skillArgs && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-testid="chat-slash-command-args"
              tabIndex={0}
              className="min-w-0 cursor-default truncate font-mono text-xs text-muted-foreground"
            >
              {skillArgs}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm whitespace-pre-wrap">
            {skillArgs}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};

SlashCommandCard.displayName = 'SlashCommandCard';
