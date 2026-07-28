/**
 * SectionSwitcher — the advisor dialog's top-level section control.
 *
 * An enclosed pill group on a filled track (the `features/tasks/TasksBoard.tsx`
 * recipe), deliberately a different material from the body's underline
 * `CategoryTabs`: the two strips share a "Skills" label, so only the material
 * tells the user which level they are on.
 */
import { cn } from '@/lib/utils';
import type { AdvisorSection } from './use-setup-advisor';

const SECTIONS: { id: AdvisorSection; label: string }[] = [
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'skills', label: 'Skills' },
];

export interface SectionSwitcherProps {
  section: AdvisorSection;
  onSelect: (section: AdvisorSection) => void;
  className?: string;
}

export function SectionSwitcher({ section, onSelect, className }: SectionSwitcherProps) {
  return (
    <div className={cn('flex items-center gap-0.5 rounded-[6px] bg-muted p-0.5', className)}>
      {SECTIONS.map(({ id, label }) => (
        <button
          key={id}
          data-testid={`setup-advisor-section-${id}`}
          type="button"
          onClick={() => onSelect(id)}
          aria-pressed={section === id}
          className={cn(
            'rounded px-2 py-1 text-label transition-colors',
            section === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
