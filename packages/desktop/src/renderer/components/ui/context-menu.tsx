import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={cn(
        'fixed z-50 min-w-[160px] py-1 rounded-mf-card',
        'bg-mf-panel-bg border border-mf-border shadow-lg',
      )}
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={cn(
            'w-full text-left px-3 py-1.5 text-mf-small hover:bg-mf-hover transition-colors',
            item.destructive ? 'text-mf-destructive' : 'text-mf-text-primary',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
