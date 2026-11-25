'use client';

/**
 * What Enter does while a turn runs (C9): the user's setting, unless the
 * chat's agent cannot take a message mid-turn, when both choices queue.
 */
import { useAdapters } from '@/store/adapters';
import { useUiPrefs, type EnterWhileRunning } from '@/store/ui-prefs';
import { useChatExtrasSelector } from '../../runtime/chat-extras';

export function useCanSteer(): boolean {
  const adapterId = useChatExtrasSelector((extras) => extras?.state.chatConfig?.adapterId);
  const adapters = useAdapters();
  return adapters.find((a) => a.id === adapterId)?.capabilities.steer === true;
}

export function useEnterMode(): EnterWhileRunning {
  const preferred = useUiPrefs((s) => s.enterWhileRunning);
  const canSteer = useCanSteer();
  return canSteer ? preferred : 'queue';
}
