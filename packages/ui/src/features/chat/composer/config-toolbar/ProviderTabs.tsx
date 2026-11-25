'use client';

/**
 * ProviderTabs — one full-width segment per provider (the Folder/GitHub tab
 * treatment) at the top of the provider/model menu.
 *
 * Before the first message a tab picks the chat's provider. After it, a tab
 * only chooses which catalog the menu shows; picking a model there asks to
 * switch. When switching is unavailable (turn running, queued messages,
 * background work, temporary chat), the other tabs are disabled and say why.
 */
import { Lock } from 'lucide-react';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { Hint } from '@/components/ui/hint';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProviderDot } from '@/features/shared/ProviderDot';
import { cn } from '@/lib/utils';

export interface ProviderTabsProps {
  adapters: AdapterInfo[];
  /** The tab whose catalog is shown. */
  selectedId: string;
  /** The chat's current provider — never disabled. */
  activeId: string;
  /** Why the other providers can't be picked right now, or null. */
  blockedReason: string | null;
  onSelect: (id: string) => void;
}

export function ProviderTabs({ adapters, selectedId, activeId, blockedReason, onSelect }: ProviderTabsProps) {
  return (
    // manual activation: automatic mode also fires onValueChange on FOCUS,
    // which would double-issue the adapter PATCH on every click.
    <Tabs
      value={selectedId}
      activationMode="manual"
      onValueChange={(v) => {
        if (v) onSelect(v);
      }}
    >
      <TabsList className="h-8! w-full gap-0.5 rounded-[9px] bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] p-0.5">
        {adapters.map((a) => {
          const blocked = a.installed && blockedReason != null && a.id !== activeId;
          const trigger = (
            <TabsTrigger
              key={a.id}
              value={a.id}
              data-testid={`composer-adapter-select-option-${a.id}`}
              aria-label={`Provider: ${a.name}`}
              disabled={!a.installed || blocked}
              className={cn(
                'h-7 min-w-0 flex-1 gap-1.5 rounded-[7px] border-0 px-1.5 py-1 text-small/[20px] font-medium text-foreground dark:text-foreground data-active:bg-card group-data-[variant=default]/tabs-list:data-active:shadow-segment dark:data-active:bg-card',
                blocked && 'w-full',
              )}
            >
              <ProviderDot adapterId={a.id} testId={`composer-adapter-logo-${a.id}`} className="size-[7px]" />
              <span className="truncate">{a.name}</span>
              {!a.installed && <Lock className="size-3 shrink-0" />}
            </TabsTrigger>
          );
          if (!blocked) return trigger;
          // A disabled button swallows pointer events, so the explanation
          // rides on a wrapper span.
          return (
            <Hint key={a.id} label={blockedReason} side="top">
              <span data-testid={`composer-adapter-switch-blocked-${a.id}`} className="h-full min-w-0 flex-1">
                {trigger}
              </span>
            </Hint>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
