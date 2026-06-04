import { useCallback } from 'react';
import { Gauge } from 'lucide-react';
import type { AdapterInfo, Chat, ChatEffort } from '@qlan-ro/mainframe-types';
import { ComposerDropdown } from './ComposerDropdown';
import { setChatTuning } from '../../../../lib/api';
import { useChatsStore } from '../../../../store/chats';
import { useSettingsStore } from '../../../../store/settings';
import { createLogger } from '../../../../lib/logger';
import { effortOptions, displayEffort } from '../../../../lib/model-tuning';

const log = createLogger('renderer:effort-picker');

/**
 * Returns true when the effort picker should render: the selected model exposes
 * at least one supported effort level. Hidden for models with no effort control
 * (e.g. Haiku) and for adapters whose models omit supportedEfforts entirely.
 */
export function shouldShowEffortPicker(adapterId: string, modelId: string, adapters: AdapterInfo[]): boolean {
  const model = adapters.find((a) => a.id === adapterId)?.models.find((m) => m.id === modelId);
  return (model?.supportedEfforts?.length ?? 0) > 0;
}

export type EffortPickerProps = {
  chat: Chat;
  adapters: AdapterInfo[];
  modelId: string;
  disabled?: boolean;
};

export function EffortPicker({ chat, adapters, modelId, disabled = false }: EffortPickerProps) {
  // Hooks must be called unconditionally — resolve data needed for both branches first.
  const updateChat = useChatsStore((s) => s.updateChat);
  const provider = useSettingsStore((s) => s.providers[chat.adapterId]);

  const handleChange = useCallback(
    (id: string) => {
      const next = id as ChatEffort;
      updateChat({ ...chat, effort: next });
      setChatTuning(chat.id, { effort: next }).catch((err) =>
        log.warn('setChatTuning failed', { err: String(err) }),
      );
    },
    [chat, updateChat],
  );

  if (!shouldShowEffortPicker(chat.adapterId, modelId, adapters)) return null;

  const model = adapters.find((a) => a.id === chat.adapterId)?.models.find((m) => m.id === modelId)!;
  const options = effortOptions(model);
  const { value: current, locked } = displayEffort(chat, model, provider);

  return (
    <ComposerDropdown
      data-testid="composer-effort-select"
      items={options}
      value={current}
      onChange={handleChange}
      disabled={disabled || locked}
      icon={<Gauge size={14} />}
    />
  );
}
