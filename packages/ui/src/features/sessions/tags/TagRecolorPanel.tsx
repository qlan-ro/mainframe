/**
 * Palette swatch picker for recoloring a tag.
 *
 * Recolor is registry-only — picking a color calls onPick(color); the parent
 * (TagPopover) does the registry update and does NOT cascade to thread
 * custom.tags (spec §5.5). Swatches paint via inline style (tag-colors.ts).
 */
import React from 'react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import { TAG_PALETTE } from '@qlan-ro/mainframe-types';
import { cn } from '../../../lib/utils';
import { TAG_DOT_STYLE } from './tag-colors';

interface Props {
  tagName: string;
  onPick: (color: TagColor) => void;
  onClose: () => void;
}

export function TagRecolorPanel({ tagName, onPick, onClose }: Props): React.ReactElement {
  return (
    <div
      data-testid="sessions-tag-recolor-panel"
      className="rounded-md border border-border bg-popover p-2 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="text-caption font-medium text-muted-foreground px-1 pb-1">Recolor &quot;{tagName}&quot;</div>
      <div className="grid grid-cols-5 gap-1">
        {TAG_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`sessions-tag-color-${c}`}
            aria-label={`Set color ${c}`}
            style={TAG_DOT_STYLE(c)}
            className={cn('w-5 h-5 rounded-full hover:scale-110 transition-transform')}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
    </div>
  );
}
