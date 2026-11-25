/** SectionsMenu — turns each panel section on or off, remembered for this viewer. */
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/hint';
import { SESSION_PANEL_SECTION_KEYS, useUiPrefs } from '@/store/ui-prefs';
import { SECTION_LABEL } from './panel-sections';

export function SectionsMenu() {
  const hidden = useUiPrefs((s) => s.sessionPanelHiddenSections);
  const setShown = useUiPrefs((s) => s.setSessionPanelSectionShown);
  return (
    <DropdownMenu>
      <Hint label="Sections">
        <DropdownMenuTrigger asChild>
          <Button
            data-testid="session-panel-sections-menu"
            aria-label="Sections"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Sections</DropdownMenuLabel>
        {SESSION_PANEL_SECTION_KEYS.map((key) => (
          <DropdownMenuCheckboxItem
            key={key}
            data-testid={`session-panel-sections-menu-${key}`}
            checked={!hidden.includes(key)}
            onCheckedChange={(checked) => setShown(key, checked)}
            // Several sections get toggled in one visit.
            onSelect={(event) => event.preventDefault()}
          >
            {SECTION_LABEL[key]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
