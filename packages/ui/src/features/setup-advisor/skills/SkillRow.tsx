/**
 * One skill row: open-to-inspect on the left, delete on the right. The two are
 * siblings rather than nested so the row stays one button and the delete stays
 * its own.
 */
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Skill } from '@qlan-ro/mainframe-types';
import { CHIP_BASE } from '@/components/ui/chip-classes';

interface SkillRowProps {
  skill: Skill;
  onOpen: (skill: Skill) => void;
  /** Omitted — not disabled — when the skill cannot be deleted. */
  onDelete?: (skill: Skill) => void;
}

export function ScopeChip({ skill }: { skill: Skill }) {
  return (
    <span className={cn(CHIP_BASE, 'flex-shrink-0 border-transparent bg-mf-chip text-muted-foreground')}>
      {skill.scope === 'plugin' && skill.pluginName ? `plugin · ${skill.pluginName}` : skill.scope}
    </span>
  );
}

export function SkillRow({ skill, onOpen, onDelete }: SkillRowProps) {
  return (
    <div className="flex items-center gap-2 pr-2 transition-colors hover:bg-accent">
      <button
        type="button"
        data-testid={`skills-section-row-${skill.id}`}
        onClick={() => onOpen(skill)}
        className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-body font-medium text-foreground">{skill.displayName || skill.name}</span>
            {skill.invocationName && (
              <span className="flex-shrink-0 font-mono text-caption text-mf-text-3">/{skill.invocationName}</span>
            )}
          </span>
          {skill.description && (
            <span className="mt-0.5 block truncate text-caption text-muted-foreground">{skill.description}</span>
          )}
        </span>
        <ScopeChip skill={skill} />
      </button>
      {onDelete && (
        <button
          type="button"
          data-testid={`skills-section-delete-${skill.id}`}
          aria-label={`Delete ${skill.displayName || skill.name}`}
          onClick={() => onDelete(skill)}
          className="flex-shrink-0 rounded-[6px] p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
