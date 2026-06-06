'use client';

/**
 * App-wide toast outlet (sonner), themed to the warm-chrome tokens.
 *
 * Mount `<Toaster />` once near the app root. Then call `toast(...)` /
 * `toast.error(...)` from ANYWHERE — sonner's API is a global imperative
 * dispatcher, so non-React code (e.g. the chat controller's WS handler) can
 * raise a toast without a hook or prop-drilling a callback.
 */
import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-body text-foreground shadow-[var(--mf-shadow-pop)]',
          description: 'text-caption text-muted-foreground',
          actionButton: 'rounded-md bg-primary px-2 py-1 text-caption font-medium text-primary-foreground',
          cancelButton: 'rounded-md border border-border px-2 py-1 text-caption text-muted-foreground',
        },
      }}
    />
  );
}
