/**
 * ChatSelectionToolbar — the floating actions offered on a text selection
 * inside a message: Quote (append to the active composition) and New session
 * (open a draft on the source chat's project, prefilled with the raw
 * selection). Neither action auto-sends (design direction, #280).
 *
 * `SelectionToolbarPrimitive.Quote` isn't used here — it writes straight into
 * the native single-quote composer state (`composer().setQuote(...)`), the
 * mechanism the multi-quote segment model replaces. Both actions instead read
 * `window.getSelection()` directly at click time; `Root`'s own `onMouseDown`
 * (and each `Action`'s) already prevents the browser from clearing the
 * selection before the click handler runs.
 *
 * In split view each zone mounts one of these, and both portal to the same
 * fixed position for any selection anywhere (SelectionToolbarPrimitive.Root's
 * own behavior). `scopeRef` — the zone's own `ThreadPrimitive.Root` element —
 * lets only the toolbar whose zone holds the selection act on it; the other
 * stays mounted (so its own primitive still tracks selection info) but hidden
 * via `display: none` rather than unmounted (#359).
 */
import type { RefObject } from 'react';
import { QuoteIcon, MessageSquarePlusIcon } from 'lucide-react';
import { SelectionToolbar } from '@/components/ui/assistant-ui/quote';
import { useOpenNewThreadDraft } from '@/features/sessions/new-thread/use-open-new-thread-draft';
import { useChatExtras } from '../runtime/chat-extras';
import { useAppendQuoteSegment } from '../composer/segments/use-append-quote-segment';
import { useSelectionInScope } from './use-selection-in-scope';

export function ChatSelectionToolbar({ scopeRef }: { scopeRef?: RefObject<HTMLElement | null> } = {}) {
  const appendQuoteSegment = useAppendQuoteSegment();
  const openNewThreadDraft = useOpenNewThreadDraft();
  const projectId = useChatExtras()?.state.chatConfig?.projectId;
  const inScope = useSelectionInScope(scopeRef);

  const handleQuote = () => {
    const text = window.getSelection()?.toString().trim();
    if (!text) return;
    appendQuoteSegment(text);
    window.getSelection()?.removeAllRanges();
  };

  const handleNewSession = () => {
    const text = window.getSelection()?.toString().trim();
    if (!text) return;
    if (projectId == null) {
      console.warn('[chat-selection-toolbar] New session — source chat has no resolvable project');
      return;
    }
    void openNewThreadDraft({ projectId, prefill: text });
  };

  return (
    <SelectionToolbar.Root style={inScope ? undefined : { display: 'none' }}>
      <SelectionToolbar.Action
        icon={QuoteIcon}
        label="Quote"
        data-testid="chat-selection-quote"
        onClick={handleQuote}
      />
      <SelectionToolbar.Action
        icon={MessageSquarePlusIcon}
        label="New session"
        data-testid="chat-selection-new-session"
        onClick={handleNewSession}
      />
    </SelectionToolbar.Root>
  );
}
