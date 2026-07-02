/**
 * ChatSessionInline — session status rendered INLINE in the ChatCardHeader
 * (2026-07-02 density pass; replaces the deleted 28px ChatSessionBar).
 *
 * `part="model"`: adapter dot + model name, right after the session title. The
 * adapter word is dropped — the dot conveys the adapter; the Hint spells both out.
 * `part="status"`: the 8-segment context meter + percentage, in the header's
 * right group. No "Thinking" label/spinner — run state is the thread's own
 * running indicator, not a redundant header label. Background-tasks pill stays
 * deferred (no task feed in app-tauri yet). Renders nothing until the chat
 * config is loaded (drafts / blank surface).
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
  if (pct >= 50) return 'bg-mf-warning opacity-60';
  return 'bg-mf-text-3 opacity-60';
}

export function ChatSessionInline({ part }: { part: 'model' | 'status' }) {
  const extras = useChatExtras();
  const adapters = useAdapters();

  const state = extras?.state;
  const chat = state?.chatConfig;
  if (state == null || chat == null) return null;

  const adapter = adapters.find((a) => a.id === chat.adapterId) ?? null;
  const model = adapter?.models.find((m) => m.id === chat.model) ?? null;

  if (part === 'model') {
    const modelLabel = model?.label ?? chat.model ?? null;
    if (modelLabel == null) return null;
    return (
      <Hint label={`${adapter?.name ?? chat.adapterId} · ${modelLabel}`}>
        <span
          data-testid="chat-header-model"
          className="inline-flex min-w-0 shrink items-center gap-[5px] text-caption"
        >
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
              className={cn('h-[9px] w-[3px] rounded-[1.5px]', i < filled ? fillClass : 'bg-mf-text-3 opacity-15')}
            />
          ))}
        </span>
      </Hint>
      <span data-testid="chat-header-context-pct" className="font-mono text-micro tabular-nums text-mf-text-3">
        {pct}%
      </span>
    </span>
  );
}
