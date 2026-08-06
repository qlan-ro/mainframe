/**
 * SkillLoadedCard — centered expandable "Using skill: X" pill.
 *
 * Rendered by SystemMessage from the system-message `skillLoaded` metadata (the
 * only place the daemon surfaces skill_loaded). Takes the skill fields directly.
 *
 *   - Zap icon + 'Using skill: {skillName}' (skillName accent).
 *   - Tooltip = path. Expandable → MarkerBody with skill content. Collapsed default.
 *   - data-testid="chat-skill-loaded-pill".
 */
import { ZapIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@v2/components/ui/tooltip';
import { MarkerWrap, MarkerPill, MarkerBody, MarkerPre, useMarkerOpen } from './marker-pill';

export interface SkillLoadedCardProps {
  skillName: string;
  path?: string;
  content?: string;
}

export function SkillLoadedCard({ skillName, path = '', content = '' }: SkillLoadedCardProps) {
  const { open, toggle } = useMarkerOpen(false);

  const expandable = content.length > 0;

  const pillLabel = (
    <>
      Using skill: <span className="text-primary">{skillName}</span>
    </>
  );

  const pill = (
    <MarkerPill
      icon={<ZapIcon className="text-primary" />}
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
          <TooltipContent side="top" className="max-w-xs font-mono break-all">
            {path}
          </TooltipContent>
        </Tooltip>
      ) : (
        pill
      )}
      {open && expandable && (
        <MarkerBody>
          <MarkerPre muted>{content}</MarkerPre>
        </MarkerBody>
      )}
    </MarkerWrap>
  );
}

SkillLoadedCard.displayName = 'SkillLoadedCard';
