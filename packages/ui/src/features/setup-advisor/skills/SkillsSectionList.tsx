/** The scope-grouped skill list. Owns no state — grouping is pure. */
import type { Skill } from '@qlan-ro/mainframe-types';
import { SectionHeader } from '@/components/ui/section-header';
import { groupByScope, isDeletable } from './skill-filters';
import { SkillRow } from './SkillRow';

const SCOPE_LABEL: Record<Skill['scope'], string> = {
  project: 'Project',
  global: 'Global',
  plugin: 'From plugins',
};

interface SkillsSectionListProps {
  skills: Skill[];
  onOpen: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
}

export function SkillsSectionList({ skills, onOpen, onDelete }: SkillsSectionListProps) {
  return (
    <div className="pb-2">
      {groupByScope(skills).map((group) => (
        <div key={group.scope} data-testid={`skills-section-group-${group.scope}`}>
          <SectionHeader className="px-4 pt-3">{SCOPE_LABEL[group.scope]}</SectionHeader>
          {group.skills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              onOpen={onOpen}
              onDelete={isDeletable(skill) ? onDelete : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
