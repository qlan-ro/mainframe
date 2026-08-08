/**
 * The palette a tag is recolored from.
 *
 * Swatches paint through an inline style: the ten tag hues are values, not
 * theme tokens, so there is no utility class to name them.
 */
import type { TagColor } from '@qlan-ro/mainframe-types';
import { TAG_PALETTE } from '@qlan-ro/mainframe-types';
import { TAG_DOT_STYLE } from '@/features/sessions/tags/tag-colors';

interface TagRecolorPanelProps {
  tagName: string;
  onPick: (color: TagColor) => void;
  onClose: () => void;
}

export function TagRecolorPanel({ tagName, onPick, onClose }: TagRecolorPanelProps) {
  return (
    <div
      data-testid="sessions-tag-recolor-panel"
      className="rounded-md border p-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">Recolor “{tagName}”</div>
      <div className="grid grid-cols-5 gap-1">
        {TAG_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            data-testid={`sessions-tag-color-${color}`}
            aria-label={`Set color ${color}`}
            style={TAG_DOT_STYLE(color)}
            className="size-5 rounded-full transition-transform hover:scale-110"
            onClick={() => onPick(color)}
          />
        ))}
      </div>
    </div>
  );
}
