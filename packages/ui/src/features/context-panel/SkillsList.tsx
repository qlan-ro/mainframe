import { Bolt } from 'lucide-react';
import { useSidebarSkills } from './use-sidebar-skills';
import { ScopedListRow } from './ScopedListRow';

export function SkillsList() {
  const { skills, loading } = useSidebarSkills();
  if (loading) return <div className="py-4 text-center text-caption text-mf-text-3">Loading…</div>;
  if (skills.length === 0) return <div className="py-4 text-center text-caption text-mf-text-3">No skills</div>;
  return (
    <div className="py-1">
      {skills.map((s) => (
        <ScopedListRow
          key={s.id}
          testId={`sidebar-skill-item-${s.id}`}
          icon={Bolt}
          name={`/${s.displayName || s.name}`}
          description={s.description}
          scope={s.scope}
          filePath={s.filePath}
        />
      ))}
    </div>
  );
}
