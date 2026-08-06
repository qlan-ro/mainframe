/**
 * use-context-percent — the active session's context-window fill, as a whole
 * percentage, or null when there is nothing trustworthy to show.
 *
 * `deriveContextPct` needs the window off the session's *resolved* model, and
 * resolving it (the session's model, else the adapter's default) is the same
 * three lines the composer's model chip runs. The rail's ring and the panel's
 * Summary row both report this number, so the resolution lives here once rather
 * than at each call site.
 */
import { useChatExtras } from '@/features/chat/runtime/use-chat-thread-runtime';
import { useAdapters } from '@/store/adapters';
import { deriveContextPct } from '@/features/chat/thread/session-bar-status';

export function useContextPercent(): number | null {
  const extras = useChatExtras();
  const adapters = useAdapters();

  const state = extras?.state;
  const chat = state?.chatConfig;
  if (state == null || chat == null) return null;

  const adapter = adapters.find((a) => a.id === chat.adapterId) ?? null;
  // chat.model is null when the session inherits the adapter default.
  const model =
    (chat.model != null ? adapter?.models.find((m) => m.id === chat.model) : undefined) ??
    adapter?.models.find((m) => m.isDefault) ??
    null;

  return deriveContextPct(state, model?.contextWindow);
}
