/**
 * SkillLoadedCard — centered expandable "Using skill: X" pill.
 *
 * Rendered by SystemMessage from the system-message `skillLoaded` metadata (the
 * only place the daemon surfaces skill_loaded). Takes the skill fields directly.
 *
 * Design (desktop SkillLoadedCard.tsx + 10-chatcards.jsx):
 *   - Zap icon (text-primary) + 'Using skill: {skillName}' (skillName accent).
 *   - Tooltip = path. Expandable → MarkerBody with skill content. Collapsed default.
 *   - data-testid="chat-skill-loaded-pill".
 */
import { ZapIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
    <span className="font-mono text-label text-muted-foreground">
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
          <TooltipContent side="top" className="font-mono text-label max-w-xs break-all">
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
