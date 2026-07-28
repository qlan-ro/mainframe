import { Bolt, SlidersHorizontal } from 'lucide-react';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { useSidebarSkills } from './use-sidebar-skills';
import { ScopedListRow } from './ScopedListRow';

/** Read-only inventory: deleting a skill lives in the advisor dialog's Skills section. */
export function SkillsList() {
  const { skills, loading } = useSidebarSkills();
  const openSheet = useSetupAdvisor((s) => s.openSheet);

  return (
    <div className="py-1">
      <div className="flex justify-end px-[12px] pb-1">
        <button
          data-testid="sidebar-skills-manage"
          type="button"
          onClick={() => openSheet('skills')}
          className="inline-flex items-center gap-[4px] text-caption text-muted-foreground transition-colors hover:text-foreground"
        >
          <SlidersHorizontal size={11} aria-hidden />
          Manage skills
        </button>
      </div>
      {loading && <div className="py-3 text-center text-caption text-muted-foreground">Loading…</div>}
      {!loading && skills.length === 0 && (
        <div className="py-3 text-center text-caption text-muted-foreground">No skills</div>
      )}
      {!loading &&
        skills.map((s) => (
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
