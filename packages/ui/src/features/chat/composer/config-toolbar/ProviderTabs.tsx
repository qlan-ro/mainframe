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
import { ProviderLogo } from '@/features/shared/ProviderLogo';
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
      <TabsList variant="line" className="w-full">
        {adapters.map((a) => {
          const blocked = a.installed && blockedReason != null && a.id !== activeId;
          const trigger = (
            <TabsTrigger
              key={a.id}
              value={a.id}
              data-testid={`composer-adapter-select-option-${a.id}`}
              aria-label={`Provider: ${a.name}`}
              disabled={!a.installed || blocked}
              className={cn(blocked && 'w-full')}
            >
              <ProviderLogo adapterId={a.id} testId={`composer-adapter-logo-${a.id}`} className="size-4 shrink-0" />
              <span className="truncate">{a.name}</span>
              {!a.installed && <Lock className="size-3 shrink-0" />}
            </TabsTrigger>
          );
          if (!blocked) return trigger;
          // A disabled button swallows pointer events, so the explanation
          // rides on a wrapper span.
          return (
            <Hint key={a.id} label={blockedReason} side="top">
              <span data-testid={`composer-adapter-switch-blocked-${a.id}`} className="h-full flex-1">
                {trigger}
              </span>
            </Hint>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
