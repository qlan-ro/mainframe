/**
 * SectionSwitcher — the Setup Advisor's top-level section control, sitting in
 * the dialog header next to the title. Same segmented recipe as the Tasks
 * board's List/Board switch.
 */
import { cn } from '@/lib/utils';
import type { AdvisorSection } from './use-setup-advisor';

const SECTIONS: readonly { id: AdvisorSection; label: string }[] = [
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'skills', label: 'Skills' },
];

interface SectionSwitcherProps {
  section: AdvisorSection;
  onSelect: (section: AdvisorSection) => void;
}

export function SectionSwitcher({ section, onSelect }: SectionSwitcherProps) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-[6px] bg-muted p-0.5">
      {SECTIONS.map(({ id, label }) => (
        <button
          key={id}
          data-testid={`setup-advisor-section-${id}`}
          type="button"
          onClick={() => onSelect(id)}
          aria-pressed={section === id}
          className={cn(
            'flex items-center gap-1 rounded px-2 py-1 text-label transition-colors',
            section === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
