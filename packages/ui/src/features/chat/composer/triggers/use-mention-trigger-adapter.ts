'use client';

/**
 * Subscribes a `MentionCache` and rebuilds its trigger adapter on every emit.
 *
 * The version counter is load-bearing, not ceremony: `useTriggerField`'s
 * navigation memo is keyed on adapter identity, so a resolved fetch that
 * doesn't produce a NEW adapter reference would never re-list. Both the
 * composer (`ComposerTriggers`) and the automations fields
 * (`use-automation-trigger-sources`) need it — one copy so the two can't drift.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AgentConfig } from '@qlan-ro/mainframe-types';
import type { TriggerAdapter } from '@/components/trigger-engine/types';
import { buildMentionTriggerAdapter, type MentionCache } from './mention-adapter';

/** Stable identity — an inline `[]` default would churn the adapter memo every render. */
const NO_AGENTS: AgentConfig[] = [];

export function useMentionTriggerAdapter(cache: MentionCache, agents: AgentConfig[] = NO_AGENTS): TriggerAdapter {
  const [version, bump] = useState(0);
  useEffect(() => cache.subscribe(() => bump((n) => n + 1)), [cache]);
  return useMemo(() => buildMentionTriggerAdapter(cache, agents), [cache, agents, version]);
}
