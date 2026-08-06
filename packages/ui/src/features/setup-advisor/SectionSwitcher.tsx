/**
 * SectionSwitcher — the Setup Advisor's top-level section control, sitting in
 * the dialog header next to the title. Same v2 Tabs segmented recipe as the
 * Tasks board's List/Board switch (List/Trigger only — the host owns the body).
 */
import { Tabs, TabsList, TabsTrigger } from '@v2/components/ui/tabs';
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
    <Tabs value={section} onValueChange={(v) => onSelect(v as AdvisorSection)} className="ml-auto w-fit shrink-0">
      <TabsList className="h-7 p-0.5">
        {SECTIONS.map(({ id, label }) => (
          <TabsTrigger key={id} value={id} data-testid={`setup-advisor-section-${id}`} className="px-2 text-xs">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
