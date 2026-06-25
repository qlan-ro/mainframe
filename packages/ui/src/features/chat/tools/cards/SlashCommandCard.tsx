/**
 * SlashCommandCard — inline row for the 'Skill' tool (slash-command invocation).
 *
 * Registry key: 'Skill'.
 * NOT a centered pill — an inline row in the message flow (no MarkerWrap).
 *
 * Design (from desktop SlashCommandCard.tsx + 10-chatcards.jsx SlashCommandCard):
 *   - Zap icon (text-primary) + '/{skill}' in font-mono text-primary.
 *   - Optional args (truncated, tooltip on hover).
 *   - No collapse, no result display.
 *   - data-testid="chat-slash-command-row".
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ZapIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export const SlashCommandCard: ToolCallMessagePartComponent = ({ args }) => {
  const skill = typeof args['skill'] === 'string' ? args['skill'] : '';
  const skillArgs = typeof args['args'] === 'string' ? args['args'] : '';

  return (
    <div data-testid="chat-slash-command-row" className="flex items-center gap-1.5 py-0.5 my-1">
      <ZapIcon size={14} className="text-primary shrink-0" />
      <span className="font-mono text-body text-primary">/{skill}</span>
      {skillArgs && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-testid="chat-slash-command-args"
              tabIndex={0}
              className="font-mono text-caption text-mf-text-3 truncate min-w-0 cursor-default"
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
