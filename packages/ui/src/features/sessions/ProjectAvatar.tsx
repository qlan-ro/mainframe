/**
 * A project's coloured initial. Shared by the scope strip, the pickers and the
 * session hover card, so a project reads the same way everywhere: avatar +
 * plain name, never coloured text.
 *
 * `ring` is the scope strip's "this one is in scope" mark: a `primary` ring
 * with a `background` gap so it reads over the overlapping neighbour. The strip
 * stacks avatars at a −6px overlap, so the ring also lifts the selected one
 * visually in front without a z-index.
 */
import { cn } from '@/lib/utils';

/** The scope strip's avatar size; pickers and hover cards pass their own. */
export const SCOPE_AVATAR_SIZE = 22;

interface ProjectAvatarProps {
  name: string;
  color: string;
  size?: number;
  /** Selected-in-scope mark (scope strip only). */
  ring?: boolean;
  /** Out-of-scope / unavailable: the avatar keeps its hue but recedes. */
  dim?: boolean;
  className?: string;
}

export function ProjectAvatar({ name, color, size = 18, ring = false, dim = false, className }: ProjectAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    // Inline style, not a utility: the ten-hue palette is hashed from the
    // project id, so it has no token to name.
    <span
      data-testid="project-avatar"
      data-ring={ring || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        ring && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        dim && 'opacity-60',
        className,
      )}
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
