/**
 * use-skills-revalidation — a monotonic nonce bumped whenever the daemon's
 * on-disk skill set may have changed (a skills-cli install/uninstall, or a
 * daemon switch). Three subscribers read it: the composer `/`-trigger
 * provider (`use-chat-skills.tsx`), the sidebar Skills tab
 * (`use-sidebar-skills.ts`), and `reset-daemon-scoped-stores.ts`, which bumps
 * it on daemon switch (D9). The automations trigger-sources field
 * deliberately does not subscribe (spec Decision 22) — it is not a live skill
 * list, so a stale value there is not a correctness problem.
 *
 * D9: `bumpSkillsRevalidation()` increments rather than resets to 0 — a
 * counter reset to 0 could equal a value a subscriber already saw and
 * suppress the very refetch a daemon switch requires.
 */
import { create } from 'zustand';

interface SkillsRevalidationState {
  nonce: number;
}

const useSkillsRevalidationStore = create<SkillsRevalidationState>(() => ({ nonce: 0 }));

export const useSkillsNonce = (): number => useSkillsRevalidationStore((s) => s.nonce);

export function bumpSkillsRevalidation(): void {
  useSkillsRevalidationStore.setState((s) => ({ nonce: s.nonce + 1 }));
}
