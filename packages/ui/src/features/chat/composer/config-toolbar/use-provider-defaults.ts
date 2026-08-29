'use client';

/**
 * useProviderDefaults — the requested adapter's saved ProviderConfig (a structural
 * TuningDefaults, D-D), read live from the shared settings store.
 *
 * Lives apart from useComposerTuning so that file keeps room for the tuning-warning
 * wiring; the hook itself is unchanged and is still re-exported from there.
 */

import { useEffect } from 'react';
import type { ProviderConfig } from '@qlan-ro/mainframe-types';
import { getProviderSettings } from '@/lib/api/settings';
import { useSettingsStore } from '@/store/settings';
import { useChatExtras } from '../../runtime/chat-extras';

/**
 * Returns this adapter's ProviderConfig (a structural TuningDefaults, D-D) live from
 * the shared settings store, or undefined while loading, on error, or when the adapter
 * has no saved config. The Settings pane writes the same store optimistically on every
 * edit, so provider-default changes reflect here without a reload. Seeds the store with
 * one fetch when nothing has loaded it yet (composer mounted, dialog never opened).
 */
export function useProviderDefaults(adapterId: string | null): ProviderConfig | undefined {
  const extras = useChatExtras();
  const port = extras?.port;
  const config = useSettingsStore((s) => (adapterId != null ? s.providers[adapterId] : undefined));

  useEffect(() => {
    if (port == null) return;
    if (Object.keys(useSettingsStore.getState().providers).length > 0) return;
    getProviderSettings(port)
      .then((data) => useSettingsStore.getState().loadProviders(data))
      .catch((err: unknown) => console.warn('[composer/useProviderDefaults] failed to load provider settings', err));
  }, [port]);

  return config;
}
