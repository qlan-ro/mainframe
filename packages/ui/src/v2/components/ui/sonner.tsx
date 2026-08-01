import * as React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Stock shadcn Toaster, minus the `next-themes` lookup — v2 has no theme
 * provider, and the CSS-variable overrides already follow the `.dark` class.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
