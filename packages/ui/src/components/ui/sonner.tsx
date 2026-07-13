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
  // `expand` is load-bearing, not cosmetic: sonner's default collapsed stack clamps every
  // toast to the front toast's height and re-lays the stack out on hover. Our cards vary in
  // height (a "Read more"-expanded error is ~300px), so hovering moved a stacked toast by
  // ~314px — out from under the pointer, which un-hovered it, which moved it back: a flicker
  // loop. Always-expanded means hover changes no geometry.
  return <SonnerToaster position="bottom-right" offset={18} gap={9} visibleToasts={5} expand />;
}
