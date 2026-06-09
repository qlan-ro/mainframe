'use client';

/**
 * ProviderModelSelect — one trigger → a popover that unifies the provider (agent)
 * choice and the model choice (replaces the separate AdapterSelect + ModelSelect).
 *
 * Top section: a PROVIDER segmented row of every registered adapter. Uninstalled
 * adapters (`installed === false`) render locked + muted; once the chat has
 * messages the WHOLE row locks (switching agents mid-thread would orphan the CLI
 * session — mirrors the desktop invariant). Bottom section: the active provider's
 * models, each with its description and a `· default` marker.
 *
 * No assistant-ui ModelContext: that targets the AI-SDK transport, which is inert
 * under our external-store runtime. Selection writes through our setAdapter/setModel
 * → PATCH /config; config is server-authoritative (the daemon's chat.updated
 * broadcast updates the toolbar — no optimistic edits here).
 *
 * Built on shadcn Popover (not raw Radix). Real mf-* tokens; never the /opacity modifier.
 */

import { useState } from 'react';
import { Check, ChevronDown, Lock } from 'lucide-react';
import type { AdapterInfo, AdapterModel, Chat } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface ProviderModelSelectProps {
  chat: Chat;
  adapters: AdapterInfo[];
  /** The resolved active adapter (chat's adapter, else default). */
  adapter: AdapterInfo | null;
  model: AdapterModel | null;
  /** True once the chat has messages — locks the provider (agent) for the session. */
  locked: boolean;
  setAdapter: (adapterId: string) => void;
  setModel: (model: string) => void;
}

/** A small dot color per known provider; neutral fallback for anything else. */
const PROVIDER_DOT: Record<string, string> = {
  claude: 'bg-orange-500',
  codex: 'bg-emerald-500',
  gemini: 'bg-blue-500',
  opencode: 'bg-violet-500',
};
function providerDot(id: string): string {
  return PROVIDER_DOT[id] ?? 'bg-muted-foreground';
}

/** Model rows, injecting a synthetic entry when the stored id isn't in the catalog. */
function modelRows(adapter: AdapterInfo | null, storedId: string | null | undefined): AdapterModel[] {
  const catalog = adapter?.models ?? [];
  if (storedId && storedId !== '' && !catalog.some((m) => m.id === storedId)) {
    return [{ id: storedId, label: storedId }, ...catalog];
  }
  return catalog;
}

interface ProviderPillProps {
  option: AdapterInfo;
  active: boolean;
  locked: boolean;
  onSelect: (id: string) => void;
}
function ProviderPill({ option, active, locked, onSelect }: ProviderPillProps) {
  const disabled = !option.installed || (locked && !active);
  return (
    <button
      type="button"
      data-testid={`composer-adapter-select-option-${option.id}`}
      aria-label={`Provider: ${option.name}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onSelect(option.id)}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-label transition-colors',
        'focus-visible:outline-none',
        active
          ? 'border-primary bg-accent text-accent-foreground font-medium'
          : 'border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
      )}
    >
      <span className={cn('inline-block size-2 flex-shrink-0 rounded-full', providerDot(option.id))} />
      <span>{option.name}</span>
      {!option.installed && <Lock size={11} className="flex-shrink-0" />}
    </button>
  );
}

interface ModelRowProps {
  option: AdapterModel;
  active: boolean;
  onSelect: (id: string) => void;
}
function ModelRow({ option, active, onSelect }: ModelRowProps) {
  const desc = option.isDefault
    ? option.description
      ? `${option.description} · default`
      : 'default'
    : option.description;
  return (
    <button
      type="button"
      data-testid={`composer-model-select-option-${option.id}`}
      onClick={() => onSelect(option.id)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      <Check size={14} className={cn('flex-shrink-0 text-primary', !active && 'invisible')} />
      <span className="flex-1 text-label font-medium text-foreground">{option.label}</span>
      {desc && <span className="text-caption text-muted-foreground">{desc}</span>}
    </button>
  );
}

export function ProviderModelSelect({
  chat,
  adapters,
  adapter,
  model,
  locked,
  setAdapter,
  setModel,
}: ProviderModelSelectProps) {
  const [open, setOpen] = useState(false);
  if (adapters.length === 0) return null;

  const active = adapter ?? adapters.find((a) => a.installed) ?? adapters[0] ?? null;
  const currentModelId = model?.id ?? chat.model ?? '';
  const rows = modelRows(active, chat.model);
  const triggerLabel = rows.find((m) => m.id === currentModelId)?.label ?? currentModelId ?? active?.name ?? '';
  const activeId = chat.adapterId ?? active?.id ?? '';

  const onPickProvider = (id: string): void => {
    if (id !== activeId) setAdapter(id);
  };
  const onPickModel = (id: string): void => {
    if (id !== currentModelId) setModel(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="composer-model-select"
              aria-label={`Provider and model: ${triggerLabel}`}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-label text-muted-foreground',
                'hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none',
              )}
            >
              <span className={cn('inline-block size-2 flex-shrink-0 rounded-full', providerDot(activeId))} />
              <span className="font-medium">{triggerLabel}</span>
              <ChevronDown size={12} className="flex-shrink-0 opacity-60" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Provider &amp; model</TooltipContent>
      </Tooltip>

      <PopoverContent
        data-testid="composer-provider-model-popover"
        align="start"
        side="top"
        sideOffset={6}
        className="w-72 p-2"
      >
        <div data-testid="composer-provider-header" className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">Provider</span>
          {locked && (
            <span className="flex items-center gap-1 text-caption text-muted-foreground">
              <Lock size={11} /> Locked
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1 px-1">
          {adapters.map((a) => (
            <ProviderPill key={a.id} option={a} active={a.id === activeId} locked={locked} onSelect={onPickProvider} />
          ))}
        </div>

        <div className="my-2 border-t border-border" />

        <div className="px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {active?.name ?? 'Models'} models
        </div>
        <div className="flex flex-col">
          {rows.map((m) => (
            <ModelRow key={m.id} option={m} active={m.id === currentModelId} onSelect={onPickModel} />
          ))}
        </div>

        {locked && (
          <p data-testid="composer-provider-footer" className="px-1 pt-2 text-caption text-muted-foreground">
            Provider stays fixed for this session.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
