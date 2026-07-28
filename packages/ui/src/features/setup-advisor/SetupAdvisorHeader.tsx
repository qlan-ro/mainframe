/**
 * SetupAdvisorHeader — the advisor dialog's title row.
 *
 * `DialogHeader` is a `flex flex-col`, so the switcher cannot simply be
 * appended next to `DialogTitle` — it would stack below it and `ml-auto` would
 * do nothing. The row below is what puts the two side by side, and `min-w-0`
 * on the title is what keeps the project name truncating now that it shares
 * the row.
 */
import { ScanSearch } from 'lucide-react';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SectionSwitcher } from './SectionSwitcher';
import type { AdvisorSection } from './use-setup-advisor';

export interface SetupAdvisorHeaderProps {
  projectName?: string;
  section: AdvisorSection;
  onSelectSection: (section: AdvisorSection) => void;
}

export function SetupAdvisorHeader({ projectName, section, onSelectSection }: SetupAdvisorHeaderProps) {
  return (
    /* pr-9 clears the dialog's built-in close button (26px at right-3). */
    <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-9">
      <div data-testid="setup-advisor-header-row" className="flex items-center gap-2">
        <DialogTitle className="flex min-w-0 items-center gap-2 text-heading font-bold">
          <ScanSearch size={14} className="shrink-0 text-primary" aria-hidden />
          Setup Advisor
          <span className="min-w-0 truncate text-body font-normal text-muted-foreground">{projectName}</span>
        </DialogTitle>
        <SectionSwitcher className="ml-auto shrink-0" section={section} onSelect={onSelectSection} />
      </div>
    </DialogHeader>
  );
}
