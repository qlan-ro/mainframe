---
"@qlan-ro/mainframe-app-tauri": minor
---

Build the four window-level states from the *Window States* artboard to parity:
`ErrorState` + `MfErrorBoundary` (wraps `App()` so a render error shows a calm recovery
panel instead of a white screen), `ConnectionOverlay` (centred warm card with an orbiting
indicator on a post-boot daemon disconnect), `TutorialOverlay` + first-run store (spotlight
coachmark tour over real chrome via four `data-tut` anchors), and a warm-chrome Toaster
(`ws-toast` card + the `mfToast` helper in `lib/toast.ts`; existing call sites migrated off
sonner's `toast`). Adds the `tw-spin` / `twPulse` / `ws-toast-rail` / `ws-indeterminate`
keyframes to `globals.css` — the components reference them via Tailwind v4 arbitrary
`animate-[…]` utilities, which do not auto-generate keyframes.
