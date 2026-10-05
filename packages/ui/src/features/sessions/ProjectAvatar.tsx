/**
 * A project's identity disc: a FILLED circle in the project's hue with a white
 * initial, so a project is recognisable by colour at a glance (and the colour
 * is learned once, everywhere it appears). Shared by the scope strip, the
 * pickers, the draft row and the session hover card.
 *
 * The fill is the palette hue darkened toward black (`FILL_MIX`), so even the
 * light hues (amber, cyan) carry a white initial in both themes.
 *
 * `ground` is the stacked mode (the scope strip): avatars overlap on that
 * surface, so each wears a 2px border in the ground colour (a clean cut-out),
 * and in that mode:
 *   - `ring` is "in scope": a 2px `primary` halo outside the cut-out, plus a
 *     `check` badge in the corner when asked for;
 *   - `dim` recedes by mixing toward the ground, not opacity (opacity would let
 *     the neighbour show through the overlap).
 * Without `ground`, `ring`/`dim` fall back to a ring utility / opacity.
 */
import { CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The scope strip's avatar size; pickers and hover cards pass their own. */
export const SCOPE_AVATAR_SIZE = 26;

interface ProjectAvatarProps {
  name: string;
  color: string;
  size?: number;
  /** Selected-in-scope mark (stacked mode). */
  ring?: boolean;
  /** Corner ✓ badge on a ringed avatar (stacked mode). */
  check?: boolean;
  /** Out-of-scope / unavailable: the avatar keeps its hue but recedes. */
  dim?: boolean;
  /** Stacked mode: the CSS colour variable of the surface underneath, e.g. `--sidebar`. */
  ground?: string;
  className?: string;
}

/** How much of the palette hue survives the darkening (the rest is black). */
const FILL_MIX = 78;

function fillOf(color: string): string {
  return `color-mix(in oklch, ${color} ${FILL_MIX}%, black)`;
}

function stackedStyle(color: string, ground: string, ring: boolean, dim: boolean): React.CSSProperties {
  const surface = `var(${ground})`;
  return {
    backgroundColor: dim ? `color-mix(in oklch, ${fillOf(color)} 40%, ${surface})` : fillOf(color),
    color: dim ? `color-mix(in oklch, white 70%, ${surface})` : 'white',
    border: `2px solid ${surface}`,
    boxShadow: ring ? '0 0 0 2px var(--primary)' : undefined,
  };
}

export function ProjectAvatar({
  name,
  color,
  size = 18,
  ring = false,
  check = false,
  dim = false,
  ground,
  className,
}: ProjectAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const stacked = ground != null;
  return (
    // Inline style, not a utility: the ten-hue palette is hashed from the
    // project id, so it has no token to name.
    <span
      data-testid="project-avatar"
      data-ring={ring || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        !stacked && ring && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        !stacked && dim && 'opacity-60',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.46),
        ...(stacked ? stackedStyle(color, ground, ring, dim) : { backgroundColor: fillOf(color), color: 'white' }),
      }}
    >
      {initial}
      {stacked && ring && check && (
        <span
          aria-hidden
          data-testid="project-avatar-check"
          className="absolute -right-1 -bottom-1 inline-flex size-3 items-center justify-center rounded-full bg-primary text-primary-foreground"
          style={{ border: `1.5px solid var(${ground})` }}
        >
          <CheckIcon className="size-2" strokeWidth={4} />
        </span>
      )}
    </span>
  );
}
