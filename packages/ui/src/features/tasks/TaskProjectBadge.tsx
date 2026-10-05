/**
 * TaskProjectBadge — the small per-item project identity disc shown on a
 * card/row only when Tasks has more than one project in scope: a
 * single-project board already knows whose task it is, so the avatar only
 * earns its place once there is a second candidate (multi-project Tasks).
 * The caller decides whether to render it at all (`project == null` means
 * "don't") — this component is just the shared disc + hint + testid.
 */
import { Hint } from '@/components/ui/hint';
import { ProjectAvatar } from '@/features/sessions/ProjectAvatar';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import type { Project } from '@qlan-ro/mainframe-types';

interface Props {
  project: Project;
  testId: string;
}

export function TaskProjectBadge({ project, testId }: Props) {
  return (
    <Hint label={project.name}>
      <span data-testid={testId} className="inline-flex shrink-0">
        <ProjectAvatar name={project.name} color={projectColor(project.id)} size={14} />
      </span>
    </Hint>
  );
}
