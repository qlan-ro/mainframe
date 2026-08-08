/**
 * A project's coloured initial. Shared by the switcher list and the session
 * hover card, so a project reads the same way everywhere: avatar + plain name,
 * never coloured text.
 */
interface ProjectAvatarProps {
  name: string;
  color: string;
  size?: number;
}

export function ProjectAvatar({ name, color, size = 18 }: ProjectAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    // Inline style, not a utility: the ten-hue palette is hashed from the
    // project id, so it has no token to name.
    <span
      data-testid="project-avatar"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
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
