/**
 * FilterPill — shared pill button for the sidebar filter bars.
 *
 * Used by ProjectFilterPillBar (no swatch, optional attention badge). When a
 * swatchColor is provided the swatch is painted via an inline style using the
 * canonical oklch values from tag-colors.ts — NOT a `bg-mf-tag-*` class, which
 * has no token in app-tauri's globals.css and would silently render nothing
 * (MEMORY Tailwind trap).
 */
import type { TagColor } from '@qlan-ro/mainframe-types';
import { TAG_DOT_STYLE } from '../tags/tag-colors';

export interface FilterPillProps {
  label: string;
  active: boolean;
  testId: string;
  onClick: () => void;
  badgeCount?: number;
  badgeTestId?: string;
  swatchColor?: TagColor;
}

export function FilterPill({
  label,
  active,
  testId,
  onClick,
  badgeCount = 0,
  badgeTestId,
  swatchColor,
}: FilterPillProps) {
  return (
    <button
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      type="button"
      className={[
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-caption font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      {swatchColor != null && (
        <span
          data-testid={`${testId}-swatch`}
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={TAG_DOT_STYLE(swatchColor)}
        />
      )}
      <span className="max-w-[140px] truncate">{label}</span>
      {badgeCount > 0 && badgeTestId != null && (
        <span
          data-testid={badgeTestId}
          className={[
            'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-micro font-bold leading-none',
            active ? 'bg-white text-primary opacity-90' : 'bg-primary text-white',
          ].join(' ')}
        >
          {badgeCount}
        </span>
      )}
    </button>
  );
}
