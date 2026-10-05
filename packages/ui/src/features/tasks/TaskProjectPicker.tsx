/**
 * TaskProjectPicker — the project choice for a new task, shared by the
 * create-form's "Project" field and the sidebar quick-add row's compact
 * chooser chip (both only appear when Tasks has more than one project in
 * scope). One `Select` so both read as the same control, just sized
 * differently via `compact`.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ProjectAvatar } from '@/features/sessions/ProjectAvatar';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { cn } from '@/lib/utils';
import type { Project } from '@qlan-ro/mainframe-types';

interface Props {
  /** Testid prefix — `${surface}-project` on the trigger, `${surface}-project-${id}` per item. */
  surface: string;
  projects: readonly Project[];
  value: string;
  onChange: (projectId: string) => void;
  /** Icon-only trigger (no name, no border) — the sidebar quick-add chip. */
  compact?: boolean;
}

function ProjectOption({ project, nameClassName }: { project: Project; nameClassName?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ProjectAvatar name={project.name} color={projectColor(project.id)} size={14} />
      <span className={cn('truncate', nameClassName)}>{project.name}</span>
    </span>
  );
}

export function TaskProjectPicker({ surface, projects, value, onChange, compact = false }: Props) {
  const selected = projects.find((p) => p.id === value);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        data-testid={`${surface}-project`}
        size="sm"
        className={compact ? 'h-6 w-fit gap-1 border-none bg-transparent px-1 shadow-none' : 'w-full'}
      >
        <SelectValue>
          {selected && <ProjectOption project={selected} nameClassName={compact ? 'sr-only' : undefined} />}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id} data-testid={`${surface}-project-${project.id}`}>
            <ProjectOption project={project} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
