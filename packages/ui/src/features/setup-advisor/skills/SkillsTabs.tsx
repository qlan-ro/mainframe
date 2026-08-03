/**
 * SkillsTabs — Browse / Installed. Underline tabs, not the segmented pill the
 * advisor header uses: this strip navigates between two lists, one level below
 * a switcher that already looks like a pill.
 */
import { cn } from '@/lib/utils';

export type SkillsTab = 'browse' | 'installed';

const TABS: readonly { id: SkillsTab; label: string }[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'installed', label: 'Installed' },
];

interface SkillsTabsProps {
  active: SkillsTab;
  onSelect: (tab: SkillsTab) => void;
}

export function SkillsTabs({ active, onSelect }: SkillsTabsProps) {
  return (
    <div className="flex shrink-0 gap-4 border-b border-border px-4">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          data-testid={`skills-section-tab-${id}`}
          aria-pressed={active === id}
          onClick={() => onSelect(id)}
          className={cn(
            '-mb-px border-b-2 py-2 text-body transition-colors',
            active === id
              ? 'border-primary font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
