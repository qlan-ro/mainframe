import * as React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { useTheme } from '@/store/theme';

/**
 * Sonner skinned with the app's tokens. `theme` follows the resolved mode so
 * sonner's own palette flips live; the card layout (grid, footer row) lives in
 * the `[data-sonner-toast]` block of styles/app.css.
 */
function Toaster({ ...props }: ToasterProps) {
  const resolvedMode = useTheme((s) => s.resolvedMode);
  return (
    <Sonner
      className="toaster group"
      theme={resolvedMode}
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-muted-foreground" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <CircleAlertIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        classNames: {
          toast: 'text-popover-foreground',
          title: 'truncate text-sm font-medium text-popover-foreground',
          description: 'text-xs',
        },
      }}
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
