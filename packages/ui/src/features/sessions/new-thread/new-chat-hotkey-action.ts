/**
 * resolveNewChatHotkeyAction — the single seam deciding what ⌘N/Ctrl+N does.
 *
 * "All" view (no project pill active) → open the SAME anchored "NEW SESSION
 * IN…" popover the sidebar "+" button opens, instead of switching straight to
 * a projectless new thread (the dead-end: no project chip, no file tree, first
 * send fails and rolls back — see use-new-chat-hotkey-handler for the wiring).
 *
 * A project pill IS active → unchanged: switch straight to a new thread;
 * useNewThreadAutoConfig seeds that project's draft on activation.
 *
 * Kept as a pure, one-line-testable function so the default is easy to flip
 * later (e.g. to seed a remembered "last used" project instead of opening the
 * picker) without touching the hotkey wiring itself.
 */
export type NewChatHotkeyAction = 'open-project-picker' | 'switch-to-new-thread';

export function resolveNewChatHotkeyAction(filterProjectId: string | null): NewChatHotkeyAction {
  return filterProjectId == null ? 'open-project-picker' : 'switch-to-new-thread';
}
