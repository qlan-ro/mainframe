/**
 * TaskProjectChips — the create-form's project picker when more than one
 * project is in scope (replaces the `TaskProjectPicker` Select dropdown,
 * 2026-10 redesign): a row of the scoped projects' avatars (the same
 * `ProjectAvatar` the scope strip uses), side by side with a small gap — NOT
 * the strip's overlapping `ground`/stacked mode, which is for a different
 * surface. The default project arrives pre-selected (via `value`, resolved by
 * the caller — `resolveDefaultTaskProject`) with the scope strip's own
 * selected treatment (the primary halo); one click or arrow key moves it.
 *
 * ARIA radiogroup: ←/→ move AND select (roving tabindex), Space/Enter selects
 * the focused avatar. The selected project's name renders below the row so
 * the choice reads in words, not just color. Renders nothing with fewer than
 * two candidate projects — the caller's own gate (`todo == null`, create mode
 * only) still decides whether to mount this at all.
 */
import { useRef, type KeyboardEvent } from 'react';
import { Hint } from '@/components/ui/hint';
import { ProjectAvatar } from '@/features/sessions/ProjectAvatar';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import type { Project } from '@qlan-ro/mainframe-types';

const CHIP_SIZE = 24;

interface Props {
  projects: readonly Project[];
  value: string;
  onChange: (projectId: string) => void;
}

export function TaskProjectChips({ projects, value, onChange }: Props) {
  // Keyed by project id, not array index — stable across a reorder.
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  if (projects.length < 2) return null;
  const selected = projects.find((p) => p.id === value);

  function selectAt(index: number) {
    const project = projects[(index + projects.length) % projects.length];
    if (!project) return;
    onChange(project.id);
    // Roving tabindex: the newly-selected avatar is the only one left in the
    // tab order, so keyboard focus must move there too, not just the
    // visual halo — otherwise a sighted keyboard user sees the selection
    // move while focus stays behind on an element Tab would now skip.
    buttonRefs.current.get(project.id)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      selectAt(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      selectAt(index - 1);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      selectAt(index);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="radiogroup"
        aria-label="Project"
        data-testid="tasks-edit-project"
        className="flex items-center gap-1.5"
      >
        {projects.map((project, index) => {
          const isSelected = project.id === value;
          return (
            <Hint key={project.id} label={project.name}>
              <button
                ref={(el) => {
                  if (el) buttonRefs.current.set(project.id, el);
                  else buttonRefs.current.delete(project.id);
                }}
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                data-testid={`tasks-edit-project-${project.id}`}
                onClick={() => onChange(project.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                <ProjectAvatar
                  name={project.name}
                  color={projectColor(project.id)}
                  size={CHIP_SIZE}
                  ring={isSelected}
                />
              </button>
            </Hint>
          );
        })}
      </div>
      {selected && <span className="text-xs text-muted-foreground">{selected.name}</span>}
    </div>
  );
}
