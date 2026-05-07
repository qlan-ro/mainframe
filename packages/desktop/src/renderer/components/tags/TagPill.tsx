import React from 'react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import { cn } from '../../lib/utils';

const COLOR_BG: Record<TagColor, string> = {
  blue: 'bg-mf-tag-blue text-white',
  red: 'bg-mf-tag-red text-white',
  purple: 'bg-mf-tag-purple text-white',
  violet: 'bg-mf-tag-violet text-white',
  amber: 'bg-mf-tag-amber text-black',
  teal: 'bg-mf-tag-teal text-white',
  cyan: 'bg-mf-tag-cyan text-black',
  green: 'bg-mf-tag-green text-white',
  pink: 'bg-mf-tag-pink text-white',
  orange: 'bg-mf-tag-orange text-white',
};

const COLOR_DOT: Record<TagColor | 'gray', string> = {
  blue: 'bg-mf-tag-blue',
  red: 'bg-mf-tag-red',
  purple: 'bg-mf-tag-purple',
  violet: 'bg-mf-tag-violet',
  amber: 'bg-mf-tag-amber',
  teal: 'bg-mf-tag-teal',
  cyan: 'bg-mf-tag-cyan',
  green: 'bg-mf-tag-green',
  pink: 'bg-mf-tag-pink',
  orange: 'bg-mf-tag-orange',
  gray: 'bg-mf-text-secondary',
};

interface Props {
  label: string;
  color: TagColor | 'gray';
  variant: 'row' | 'filter';
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function TagPill({ label, color, variant, active, onClick, onContextMenu }: Props): React.ReactElement {
  if (variant === 'row') {
    const cls = color === 'gray' ? 'bg-mf-text-secondary text-white' : COLOR_BG[color];
    return (
      <span
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={cn(
          'inline-flex items-center px-2 py-0.5 rounded-full border border-transparent text-xs font-medium cursor-pointer',
          cls,
        )}
      >
        {label}
      </span>
    );
  }
  // filter variant
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border transition-colors',
        active
          ? 'border-mf-accent bg-mf-hover text-mf-text-primary'
          : 'border-mf-border text-mf-text-secondary hover:bg-mf-hover',
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', COLOR_DOT[color])} />
      {label}
    </button>
  );
}
