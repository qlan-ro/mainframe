'use client';

/**
 * ProviderModelSelect — one trigger → the composer's provider + model menu.
 *
 * A floating list of choices is a native DropdownMenu (ledger rule, 2026-08-05).
 * The PROVIDER segmented row rides at the top as non-item chrome, the way the
 * branch menu carries its search field: it holds focusable buttons, so it stops
 * keydown propagation or Radix's typeahead would eat the keystrokes.
 *
 * Each model row is a `ModelMenuRow` — click to choose, hover for that model's
 * effort/options flyout (the Cursor pattern). That flyout replaces the toolbar's
 * former standalone EffortPicker chip and FeaturesPopover gear.
 *
 * Uninstalled adapters (`installed === false`) render locked + muted; once the
 * chat has messages the WHOLE provider row locks (switching agents mid-thread
 * would orphan the CLI session — mirrors the desktop invariant).
 *
 * `locked` and `disabled` are different rules: `locked` freezes the provider row
 * for the session, `disabled` makes the whole picker inert while a turn runs, so
 * no model change can reach a CLI mid-answer.
 *
 * No assistant-ui ModelContext: that targets the AI-SDK transport, which is inert
 * under our external-store runtime. Selection writes through our setAdapter/setModel
 * → PATCH /config; config is server-authoritative (the daemon's chat.updated
 * broadcast updates the toolbar — no optimistic edits here).
 */

import { Fragment, useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import type {
  AdapterInfo,
  AdapterModel,
  Chat,
  EffortLevel,
  FeatureKey,
  ProviderConfig,
} from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@v2/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { RunningHint } from './RunningHint';
import { ModelMenuRow } from './ModelMenuRow';
import { groupSlug, modelRows, partitionModels } from './model-menu-rows';

export interface ProviderModelSelectProps {
  chat: Chat;
  adapters: AdapterInfo[];
  /** The resolved active adapter (chat's adapter, else default). */
  adapter: AdapterInfo | null;
  model: AdapterModel | null;
  /** True once the chat has messages — locks the provider (agent) for the session. */
  locked: boolean;
  /** True while a turn is running — the whole picker goes inert, as the other controls do. */
  disabled: boolean;
  providerDefaults?: ProviderConfig;
  setAdapter: (adapterId: string) => void;
  setModel: (model: string) => void;
  setEffort: (effort: EffortLevel) => void;
  setFeature: (key: FeatureKey, on: boolean) => void;
}

/** A small dot color per known provider; neutral fallback for anything else.
 *  Exported for ChatSessionInline so the header chip and the picker always agree. */
const PROVIDER_DOT: Record<string, string> = {
  claude: 'bg-orange-500',
  codex: 'bg-emerald-500',
  gemini: 'bg-blue-500',
  opencode: 'bg-violet-500',
};
export function providerDot(id: string): string {
  return PROVIDER_DOT[id] ?? 'bg-muted-foreground';
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
        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
        'focus-visible:outline-none',
        active
          ? 'border-primary bg-mf-selection font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
      )}
    >
      <span className={cn('inline-block size-1.5 flex-shrink-0 rounded-full', providerDot(option.id))} />
      <span>{option.name}</span>
      {!option.installed && <Lock size={11} className="flex-shrink-0" />}
    </button>
  );
}

export function ProviderModelSelect({
  chat,
  adapters,
  adapter,
  model,
  locked,
  disabled,
  providerDefaults,
  setAdapter,
  setModel,
  setEffort,
  setFeature,
}: ProviderModelSelectProps) {
  const [open, setOpen] = useState(false);
  if (adapters.length === 0) return null;

  const active = adapter ?? adapters.find((a) => a.installed) ?? adapters[0] ?? null;
  const currentModelId = model?.id ?? chat.model ?? '';
  const rows = modelRows(active, chat.model);
  const { current, older, groups } = partitionModels(rows);
  const triggerLabel = rows.find((m) => m.id === currentModelId)?.label ?? currentModelId ?? active?.name ?? '';
  const activeId = chat.adapterId ?? active?.id ?? '';

  const onPickProvider = (id: string): void => {
    if (id !== activeId) setAdapter(id);
  };
  const onPickModel = (id: string): void => {
    if (id !== currentModelId) setModel(id);
    setOpen(false);
  };

  const renderRow = (m: AdapterModel) => (
    <ModelMenuRow
      key={m.id}
      option={m}
      active={m.id === currentModelId}
      chat={chat}
      providerDefaults={providerDefaults}
      onSelect={onPickModel}
      setEffort={setEffort}
      setFeature={setFeature}
    />
  );

  return (
    <RunningHint active={disabled}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Radix gates opening on the TRIGGER's own `disabled`; a disabled
                child button alone still lets pointerdown open the menu. */}
            <DropdownMenuTrigger asChild disabled={disabled}>
              <button
                type="button"
                data-testid="composer-model-select"
                data-tut="model"
                disabled={disabled}
                aria-label={`Provider and model: ${triggerLabel}`}
                className={cn(
                  'flex h-[20px] min-w-0 items-center gap-[5px] rounded-[11px] border-[0.5px] border-border pl-[8px] pr-[7px] text-xs text-muted-foreground',
                  'hover:bg-accent hover:text-accent-foreground',
                  // Driven by state, not data-[state=open]: TooltipTrigger asChild
                  // overwrites the child's data-state with the tooltip's own.
                  open && 'border-primary bg-mf-selection',
                  'transition-colors focus-visible:outline-none',
                  'disabled:pointer-events-none disabled:opacity-40',
                )}
              >
                <span className={cn('inline-block size-1.5 flex-shrink-0 rounded-full', providerDot(activeId))} />
                <span className="max-w-[150px] truncate font-medium @max-[560px]:max-w-[90px] @max-[430px]:max-w-[56px]">
                  {triggerLabel}
                </span>
                <ChevronDown size={12} className="flex-shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">Provider &amp; model</TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          data-testid="composer-provider-model-popover"
          align="start"
          side="top"
          sideOffset={6}
          className="w-72"
        >
          <DropdownMenuLabel data-testid="composer-provider-header" className="flex items-center justify-between">
            <span>Provider</span>
            {locked && (
              <span className="flex items-center gap-1 font-normal">
                <Lock size={12} /> Locked
              </span>
            )}
          </DropdownMenuLabel>

          {/* Non-item chrome holding real buttons — keystrokes stay here rather
              than driving the menu's typeahead. Escape still closes. */}
          <div
            className="flex flex-wrap gap-1 px-2 pb-1"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') e.stopPropagation();
            }}
          >
            {adapters.map((a) => (
              <ProviderPill
                key={a.id}
                option={a}
                active={a.id === activeId}
                locked={locked}
                onSelect={onPickProvider}
              />
            ))}
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuLabel>{active?.name ?? 'Models'} models</DropdownMenuLabel>
          {current.map(renderRow)}
          {older.length > 0 && (
            <>
              <DropdownMenuLabel data-testid="composer-model-older-header">Older models</DropdownMenuLabel>
              {older.map(renderRow)}
            </>
          )}
          {groups.map(([label, models]) => (
            <Fragment key={label}>
              <DropdownMenuLabel data-testid={`composer-model-group-header-${groupSlug(label)}`}>
                {label}
              </DropdownMenuLabel>
              {models.map(renderRow)}
            </Fragment>
          ))}

          <p data-testid="composer-provider-footer" className="px-2 pt-2 text-xs text-muted-foreground">
            {locked ? 'Provider stays fixed for this session.' : 'Pick a provider before your first message.'}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </RunningHint>
  );
}
