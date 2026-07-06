/**
 * useNewSessionPickerTarget — lifts the "All view" NEW SESSION IN… popover's
 * open state out of SessionsNewButton so other entry points can drive the SAME
 * anchored popover instead of duplicating it:
 *   - the sidebar "+" button (SessionsNewButton) — click toggles it directly.
 *   - the global ⌘N/Ctrl+N hotkey in "All" view (no project pill active) —
 *     see use-new-chat-hotkey-handler.
 *   - the zero-session boot fallback — see ChatSurface's boot-settle effect.
 *
 * Mirrors the use-tag-popover-target / use-daemon-dialog-target host pattern:
 * a tiny zustand store as the shared seam, no prop drilling.
 */
import { create } from 'zustand';

interface NewSessionPickerTargetState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useNewSessionPickerTarget = create<NewSessionPickerTargetState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
