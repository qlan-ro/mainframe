/**
 * AdvisorSidebarList — the sidebar's Setup Advisor view (the nav rail's
 * fourth list, D8). Header: "Setup Advisor" + the shared scope strip (D7) —
 * the advisor needs exactly one project, same rule as Tasks. Rows: the two
 * sections that drive the body (Recommendations, Skills) — the old header's
 * `SectionSwitcher` Tabs, restyled to sidebar rows like Settings' categories.
 */
import { cn } from '@/lib/utils';
import { SidebarHeader } from '@/components/ui/sidebar';
import { SidebarScopeStrip } from '@/features/sessions/SidebarScopeStrip';
import { SidebarScrollRegion } from '@/features/shared/SidebarScrollRegion';
import { useSetupAdvisor, type AdvisorSection } from './use-setup-advisor';

const SECTIONS: readonly { id: AdvisorSection; label: string }[] = [
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'skills', label: 'Skills' },
];

export function AdvisorSidebarList() {
  const section = useSetupAdvisor((s) => s.section);
  const setSection = useSetupAdvisor((s) => s.setSection);

  return (
    <>
      <SidebarHeader className="gap-3">
        <div className="flex h-9 items-center pl-1">
          <span className="text-base font-semibold">Setup Advisor</span>
        </div>
        <SidebarScopeStrip />
      </SidebarHeader>
      <SidebarScrollRegion>
        <div className="flex flex-col gap-0.5 px-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              data-testid={`setup-advisor-sidebar-section-${s.id}`}
              onClick={() => setSection(s.id)}
              className={cn(
                'flex h-7 w-full items-center rounded-md px-2 text-left text-sm transition-colors',
                section === s.id
                  ? 'bg-sidebar-selection font-semibold text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </SidebarScrollRegion>
    </>
  );
}
