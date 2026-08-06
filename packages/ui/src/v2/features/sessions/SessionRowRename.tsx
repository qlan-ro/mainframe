/**
 * Inline rename input, in place of the row title.
 *
 * Focus survives a re-sort: it holds its own ref and focuses in a layout effect
 * on every render, so a list update mid-rename cannot steal the caret.
 */
import { useLayoutEffect, useRef, useState } from 'react';

interface SessionRowRenameProps {
  initialTitle: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}

export function SessionRowRename({ initialTitle, onCommit, onCancel }: SessionRowRenameProps) {
  const [value, setValue] = useState(initialTitle);
  const ref = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    ref.current?.focus();
  });

  function commit() {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === initialTitle) onCancel();
    else onCommit(trimmed);
  }

  return (
    <input
      ref={ref}
      data-testid="sessions-rename-input"
      className="h-4.5 w-full min-w-0 rounded-sm border border-input bg-background px-1.5 text-xs text-foreground ring-1 ring-ring outline-hidden"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
