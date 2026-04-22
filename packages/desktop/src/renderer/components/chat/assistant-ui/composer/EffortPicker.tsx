import React, { useCallback } from 'react';
import { Gauge } from 'lucide-react';
import type { AdapterInfo, Chat, ChatEffort } from '@qlan-ro/mainframe-types';
import { ComposerDropdown } from './ComposerDropdown';
import { setChatEffort } from '../../../../lib/api';
import { useChatsStore } from '../../../../store/chats';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('renderer:effort-picker');

export const EFFORT_OPTIONS: { id: ChatEffort; label: string; description: string }[] = [
  { id: 'low', label: 'Low', description: 'Quick, straightforward implementation' },
  { id: 'medium', label: 'Medium', description: 'Balanced speed and depth' },
  { id: 'high', label: 'High', description: 'Thorough reasoning and testing' },
];

/**
 * Returns true when the picker should render: adapter is Claude AND the selected
 * model exposes supportsEffort. Hidden for Codex, Gemini, OpenCode, and for
 * Claude models without the capability (Haiku 3.5/4.5, older Sonnets).
 */
export function shouldShowEffortPicker(adapterId: string, modelId: string, adapters: AdapterInfo[]): boolean {
  if (adapterId !== 'claude' && adapterId !== 'claude-sdk') return false;
  const adapter = adapters.find((a) => a.id === adapterId);
  if (!adapter) return false;
  const model = adapter.models.find((m) => m.id === modelId);
  return Boolean(model?.supportsEffort);
}

export function EffortPicker({
  chat,
  adapters,
  modelId,
  disabled = false,
}: {
  chat: Chat;
  adapters: AdapterInfo[];
  modelId: string;
  disabled?: boolean;
}) {
  if (!shouldShowEffortPicker(chat.adapterId, modelId, adapters)) return null;

  const current = chat.effort ?? 'medium';
  const updateChat = useChatsStore((s) => s.updateChat);

  const handleChange = useCallback(
    (id: string) => {
      const next = id as ChatEffort;
      updateChat({ ...chat, effort: next });
      setChatEffort(chat.id, next).catch((err) => log.warn('setChatEffort failed', { err: String(err) }));
    },
    [chat, updateChat],
  );

  return (
    <ComposerDropdown
      items={EFFORT_OPTIONS}
      value={current}
      onChange={handleChange}
      disabled={disabled}
      icon={<Gauge size={14} />}
    />
  );
}
