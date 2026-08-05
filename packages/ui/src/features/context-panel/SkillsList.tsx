import { Bolt } from 'lucide-react';
import type { Skill } from '@qlan-ro/mainframe-types';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { useSidebarSkills } from './use-sidebar-skills';
import { ScopedListRow } from './ScopedListRow';

/** Read-only: rows open the SKILL.md; installing and uninstalling live in the Setup Advisor. */
export function SkillsList() {
  const { skills, loading } = useSidebarSkills();
  return (
    <div className="py-1">
      <div className="flex justify-end px-[12px] pb-[4px]">
        <button
          type="button"
          data-testid="sidebar-skills-manage"
          onClick={() => useSetupAdvisor.getState().openSheet('skills')}
          className="text-xs font-semibold text-primary transition-colors hover:underline"
        >
          Manage
        </button>
      </div>
      <SkillRows skills={skills} loading={loading} />
    </div>
  );
}

function SkillRows({ skills, loading }: { skills: Skill[]; loading: boolean }) {
  if (loading) return <div className="py-4 text-center text-xs text-muted-foreground">Loading…</div>;
  if (skills.length === 0) return <div className="py-4 text-center text-xs text-muted-foreground">No skills</div>;
  return (
    <>
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
    </>
  );
}
