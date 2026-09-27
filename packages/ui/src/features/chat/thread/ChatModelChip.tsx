import { useSessionModel } from '../composer/config-toolbar/use-session-model';
import { useProviderDefaults } from '../composer/config-toolbar/use-provider-defaults';
import { modelSelectionHint } from '@/lib/cli-model';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { useChatExtras } from '../runtime/chat-extras';
import { useAdapters } from '../composer/config-toolbar/use-composer-tuning';
import { providerDot } from '../composer/config-toolbar/ProviderModelSelect';

export function ChatModelChip() {
  const extras = useChatExtras();
  const adapters = useAdapters();

  const state = extras?.state;
  const chat = state?.chatConfig ?? null;
  const catalog = adapters.find((a) => a.id === chat?.adapterId) ?? null;
  const provider = useProviderDefaults(catalog?.id ?? null);
  const { adapter, model, runningModel } = useSessionModel(extras?.port ?? null, catalog, chat, state, provider);
  if (!chat || !model) return null;
  const modelLabel = (runningModel ?? model).label;

  return (
    <Hint
      label={`${adapter?.name ?? chat.adapterId} · ${modelSelectionHint(model, runningModel, chat.processState != null || state?.runState?.type === 'running')}`}
    >
      <span data-testid="chat-header-model" className="inline-flex min-w-0 shrink items-center gap-1.5 text-xs">
        <span className={cn('size-1.5 shrink-0 rounded-full', providerDot(chat.adapterId))} />
        <span className="truncate font-medium text-muted-foreground">{modelLabel}</span>
      </span>
    </Hint>
  );
}
