/**
 * ChatModelChip — the adapter dot + model name rendered INLINE in the
 * ChatCardHeader, right after the session title (2026-07-02 density pass;
 * replaces the deleted 28px ChatSessionBar).
 *
 * The adapter word is dropped — the dot conveys the adapter; the Hint spells
 * both out. Context usage is NOT here: the session panel's rail ring and Summary
 * row own that number now, so the header's own 8-cell meter went with the
 * revamp. Renders nothing until the chat config is loaded (drafts / blank
 * surface).
 */
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { useAdapters } from '../composer/config-toolbar/use-composer-tuning';
import { providerDot } from '../composer/config-toolbar/ProviderModelSelect';

export function ChatModelChip() {
  const extras = useChatExtras();
  const adapters = useAdapters();

  const state = extras?.state;
  const chat = state?.chatConfig;
  if (state == null || chat == null) return null;

  const adapter = adapters.find((a) => a.id === chat.adapterId) ?? null;
  // chat.model is null when the session inherits the adapter default (see
  // use-composer-tuning.ts's own resolution) — fall back to the adapter's
  // isDefault model so the chip still shows a label before any turn.
  const model =
    (chat.model != null ? adapter?.models.find((m) => m.id === chat.model) : undefined) ??
    adapter?.models.find((m) => m.isDefault) ??
    null;

  const modelLabel = model?.label ?? chat.model ?? null;
  if (modelLabel == null) return null;

  return (
    <Hint label={`${adapter?.name ?? chat.adapterId} · ${modelLabel}`}>
      <span data-testid="chat-header-model" className="inline-flex min-w-0 shrink items-center gap-1.5 text-xs">
        <span className={cn('size-1.5 shrink-0 rounded-full', providerDot(chat.adapterId))} />
        <span className="truncate font-medium text-muted-foreground">{modelLabel}</span>
      </span>
    </Hint>
  );
}
