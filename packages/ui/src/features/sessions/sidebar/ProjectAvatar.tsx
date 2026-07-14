/**
 * ProjectAvatar — a small colored-initial avatar identifying a project.
 * Shared between the project switcher list (ProjectPillContextMenu) and the
 * session hover-detail card (SessionMetaCard), so a project reads the same
 * way everywhere: icon/avatar + plain name, never colored text.
 */
interface ProjectAvatarProps {
  name: string;
  color: string;
  size?: number;
}

export function ProjectAvatar({ name, color, size = 18 }: ProjectAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      data-testid="project-avatar"
      className="inline-flex flex-shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.55),
        backgroundColor: `color-mix(in oklch, ${color} 18%, transparent)`,
        color,
      }}
    >
      {initial}
    </span>
  );
}
