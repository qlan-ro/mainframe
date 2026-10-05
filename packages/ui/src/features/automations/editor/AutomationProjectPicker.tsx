/**
 * AutomationProjectPicker — the new-automation editor's own project picker
 * (replaces the old "pick a project in the library header" ambient-scope
 * gating): a row of avatar chips, a radio group, non-stacked (`ProjectAvatar`
 * side by side, not the sidebar's overlapping `ground` mode). "All projects"
 * is the first choice — automations CAN be global now; `AutomationEditor`
 * blocks saving one unscoped only when it contains an `ask_agent` step
 * (`stepsNeedProject`), the one case that genuinely needs a project.
 *
 * Hidden entirely when there is only one project to choose — the sole
 * project is the only sane default, so showing a one-option radio group is
 * pure noise. Keyboard: ←/→ moves AND selects (a roving-tabindex radiogroup,
 * same as the scope strip); Space/Enter is the chip button's own default.
 */
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { ProjectAvatar } from '@/features/sessions/ProjectAvatar';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import type { Project } from '@qlan-ro/mainframe-types';

const CHIP_SIZE = 24;
const ALL_KEY = 'all';

interface Entry {
  id: string | null;
  name: string;
}

function domId(id: string | null): string {
  return `automations-editor-project-chip-${id ?? ALL_KEY}`;
}

/**
 * Default selection for a brand-new automation: the sole project when
 * exactly one is in scope; otherwise the given "active" project if it's one
 * of the scoped ones, else the first scoped project; `null` (global) only
 * when there are no projects to default to at all.
 */
export function resolveDefaultProjectId(scopedProjects: Project[], activeProjectId: string | null): string | null {
  if (scopedProjects.length === 1) return scopedProjects[0]!.id;
  if (activeProjectId && scopedProjects.some((p) => p.id === activeProjectId)) return activeProjectId;
  return scopedProjects[0]?.id ?? null;
}

export interface AutomationProjectPickerProps {
  projects: Project[];
  value: string | null;
  onChange: (projectId: string | null) => void;
}

export function AutomationProjectPicker({ projects, value, onChange }: AutomationProjectPickerProps) {
  if (projects.length <= 1) return null;

  const entries: Entry[] = [{ id: null, name: 'All projects' }, ...projects.map((p) => ({ id: p.id, name: p.name }))];
  const selectedName = entries.find((e) => e.id === value)?.name ?? 'All projects';

  function moveTo(index: number) {
    const next = entries[(index + entries.length) % entries.length]!;
    onChange(next.id);
    document.getElementById(domId(next.id))?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveTo(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveTo(index - 1);
    }
  }

  return (
    <div className="flex flex-col gap-[6px]">
      <div
        data-testid="automations-editor-project"
        role="radiogroup"
        aria-label="Project"
        className="flex items-center gap-[6px]"
      >
        {entries.map((entry, i) => {
          const selected = entry.id === value;
          return (
            <Hint key={entry.id ?? ALL_KEY} label={entry.name}>
              <button
                id={domId(entry.id)}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-testid={`automations-editor-project-${entry.id ?? ALL_KEY}`}
                onClick={() => onChange(entry.id)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                className="flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {entry.id == null ? (
                  <span
                    className={cn(
                      'flex items-center justify-center rounded-full bg-muted text-muted-foreground',
                      selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                    )}
                    style={{ width: CHIP_SIZE, height: CHIP_SIZE }}
                  >
                    <Globe size={13} aria-hidden />
                  </span>
                ) : (
                  <ProjectAvatar name={entry.name} color={projectColor(entry.id)} size={CHIP_SIZE} ring={selected} />
                )}
              </button>
            </Hint>
          );
        })}
      </div>
      <span data-testid="automations-editor-project-name" className="text-xs text-muted-foreground">
        {selectedName}
      </span>
    </div>
  );
}
