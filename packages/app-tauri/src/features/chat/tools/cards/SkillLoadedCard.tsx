/**
 * SkillLoadedCard — centered expandable pill for the '_SkillLoaded' tool.
 *
 * Registry key: '_SkillLoaded'.
 * Args: { skillName: string; path: string; content: string }.
 *
 * Design (from desktop SkillLoadedCard.tsx + 10-chatcards.jsx SkillLoadedCard):
 *   - Zap icon (text-primary) + 'Using skill: {skillName}' (skillName accent).
 *   - Tooltip = path.
 *   - Expandable → MarkerBody with skill content as preformatted text.
 *   - Default collapsed (always has a result — args carry the content).
 *   - data-testid="chat-skill-loaded-pill".
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ZapIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MarkerWrap, MarkerPill, MarkerBody, MarkerPre, useMarkerOpen } from './marker-pill';

export const SkillLoadedCard: ToolCallMessagePartComponent = ({ args }) => {
  const skillName = typeof args['skillName'] === 'string' ? args['skillName'] : '';
  const path = typeof args['path'] === 'string' ? args['path'] : '';
  const content = typeof args['content'] === 'string' ? args['content'] : '';
  const { open, toggle } = useMarkerOpen(false);

  const expandable = content.length > 0;

  const pillLabel = (
    <span className="font-mono text-caption text-mf-text-3">
      Using skill: <span className="text-primary">{skillName}</span>
    </span>
  );

  const pill = (
    <MarkerPill
      icon={<ZapIcon size={12} className="text-primary" />}
      state="done"
      expandable={expandable}
      open={open}
      onClick={toggle}
      testId="chat-skill-loaded-pill"
    >
      {pillLabel}
    </MarkerPill>
  );

  return (
    <MarkerWrap>
      {path ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{pill}</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="font-mono text-caption max-w-xs break-all">
            {path}
          </TooltipContent>
        </Tooltip>
      ) : (
        pill
      )}
      {open && expandable && (
        <MarkerBody>
          <div className="max-h-[360px] overflow-y-auto">
            <MarkerPre muted>{content}</MarkerPre>
          </div>
        </MarkerBody>
      )}
    </MarkerWrap>
  );
};

SkillLoadedCard.displayName = 'SkillLoadedCard';
