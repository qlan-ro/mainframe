'use client';

/**
 * App-wide toast outlet (sonner) — portal container for WsToastCard stacks.
 *
 * Mount `<Toaster />` once near the app root (App.tsx — no change needed).
 * Fire toasts via `mfToast.*` from `@/lib/toast`, which uses `toast.custom()`
 * to render fully-styled WsToastCard instances. The SonnerToaster acts only
 * as the portal container and stack manager; its own style options are
 * irrelevant because every toast is rendered via `toast.custom()`.
 */
import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return <SonnerToaster position="bottom-right" offset={18} gap={9} visibleToasts={5} />;
}
