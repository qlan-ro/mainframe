/**
 * ChatSessionInline — session status rendered INLINE in the ChatCardHeader
 * (2026-07-02 density pass; replaces the deleted 28px ChatSessionBar).
 *
 * `part="model"`: adapter dot + model name, right after the session title. The
 * adapter word is dropped — the dot conveys the adapter; the Hint spells both out.
 * `part="status"`: the 8-segment context meter + percentage, in the header's
 * right group. No "Thinking" label/spinner — run state is the thread's own
 * running indicator, not a redundant header label. Background work lives in
 * the composer's BackgroundActivityBar, not here. Renders nothing until the
 * chat config is loaded (drafts / blank surface).
 */
import { cn } from '@/lib/utils';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { useAdapters } from '../composer/config-toolbar/use-composer-tuning';
import { providerDot } from '../composer/config-toolbar/ProviderModelSelect';
import { deriveContextPct } from './session-bar-status';
import { Hint } from '@/components/ui/hint';

const SEGMENTS = 8;

function segmentColor(pct: number): string {
  if (pct >= 90) return 'bg-destructive';
  if (pct >= 75) return 'bg-mf-warning';
  if (pct >= 50) return 'bg-mf-warning opacity-[0.67]';
  // <50% tier keys off muted-foreground (design T.text2), not the lighter
  // mf-text-3 — matches the design's ~67%-alpha low-fill segment (15.4).
  return 'bg-muted-foreground opacity-60';
}

export function ChatSessionInline({ part }: { part: 'model' | 'status' }) {
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

  if (part === 'model') {
    const modelLabel = model?.label ?? chat.model ?? null;
    if (modelLabel == null) return null;
    return (
      <Hint label={`${adapter?.name ?? chat.adapterId} · ${modelLabel}`}>
        <span data-testid="chat-header-model" className="inline-flex min-w-0 shrink items-center gap-[5px] text-label">
          <span className={cn('size-1.5 flex-shrink-0 rounded-full', providerDot(chat.adapterId))} />
          <span className="truncate font-medium text-muted-foreground">{modelLabel}</span>
        </span>
      </Hint>
    );
  }

  const pct = deriveContextPct(state, model?.contextWindow);
  if (pct == null) return null;
  const filled = Math.round((pct / 100) * SEGMENTS);
  const fillClass = segmentColor(pct);

  return (
    <span data-testid="chat-header-context" className="inline-flex flex-shrink-0 items-center gap-1.5">
      <Hint label={`Context: ${pct}% used`}>
        <span className="inline-flex gap-[1.5px]">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-[9px] w-[3px] rounded-[1.5px]',
                // Unfilled segments key off muted-foreground (design T.text2), not
                // the lighter mf-text-3 — matches the design's ~15%-alpha unfilled
                // segment color (15.4).
                i < filled ? fillClass : 'bg-muted-foreground opacity-15',
              )}
            />
          ))}
        </span>
      </Hint>
      <span data-testid="chat-header-context-pct" className="font-mono text-caption tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </span>
  );
}
