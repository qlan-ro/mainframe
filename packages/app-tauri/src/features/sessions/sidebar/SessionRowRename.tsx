/**
 * SessionRowRename — inline input for renaming a session.
 *
 * Focus-survives-resort: holds its own ref and focuses in a layout effect, so a
 * list re-render around it (e.g. a sort-order update mid-rename) cannot steal focus.
 *
 * Prop-driven — onCommit/onCancel are supplied by SessionRow.
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
    if (trimmed === '' || trimmed === initialTitle) {
      onCancel();
    } else {
      onCommit(trimmed);
    }
  }

  return (
    <input
      ref={ref}
      data-testid="sessions-rename-input"
      className="w-full rounded border border-primary bg-background px-1.5 py-0.5 text-body text-foreground outline-none ring-1 ring-primary"
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
