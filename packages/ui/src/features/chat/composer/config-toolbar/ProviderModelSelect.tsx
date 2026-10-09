'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  AdapterInfo,
  AdapterModel,
  Chat,
  EffortLevel,
  FeatureKey,
  ProviderConfig,
  SessionTuning,
} from '@qlan-ro/mainframe-types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/hint';
import { ProviderDot } from '@/features/shared/ProviderDot';
import { modelSelectionHint } from '@/lib/cli-model';
import { cn } from '@/lib/utils';
import { displayEffort, effortOptions, EFFORT_META } from '@/lib/model-tuning';
import { RunningHint } from './RunningHint';
import { ModelMenuRow } from './ModelMenuRow';
import { groupSlug, modelRows, partitionModels } from './model-menu-rows';
import { PROVIDER_PICK_FOOTER, PROVIDER_SWITCH_FOOTER } from './provider-switch';
import { ProviderTabs } from './ProviderTabs';
import type { ProviderSwitchRequest } from './use-provider-switch';

export interface ProviderModelSelectProps {
  chat: Chat;
  adapters: AdapterInfo[];
  /** The resolved active adapter (chat's adapter, else default). */
  adapter: AdapterInfo | null;
  model: AdapterModel | null;
  runningModel?: AdapterModel | null;
  showCurrentModel?: boolean;
  /** True once the chat has messages: a provider tab then browses its catalog,
   *  and picking one of its models asks to switch the chat in place. */
  locked: boolean;
  /** Why switching providers is unavailable right now (shown on the tabs), or null. */
  switchBlockedReason?: string | null;
  /** Asks to continue the chat on another provider (opens the confirmation). */
  onSwitchProvider?: (request: ProviderSwitchRequest) => void;
  /** True while a turn is running — the whole picker goes inert, as the other controls do. */
  disabled: boolean;
  providerDefaults?: ProviderConfig;
  setAdapter: (adapterId: string) => void;
  setModel: (model: string) => void;
  setModelTuning: (model: string, tuning: SessionTuning) => void;
  setEffort: (effort: EffortLevel) => void;
  setFeature: (key: FeatureKey, on: boolean) => void;
  /** Hides the provider-switching row (todo #344 side-chat panel: the side
   *  chat's adapter is a one-time copy of the parent's and never switches).
   *  The model catalog for the fixed adapter still renders. */
  hideProviderSwitch?: boolean;
}

interface ModelSectionProps {
  label: string;
  testId: string;
  /** A section holding the checked model starts open — the selection must never load hidden. */
  containsCurrent: boolean;
  children: React.ReactNode;
}

/** Secondary model sections (Older models, catalog groups) fold away by default. */
function CollapsibleModelSection({ label, testId, containsCurrent, children }: ModelSectionProps) {
  const [expanded, setExpanded] = useState(containsCurrent);
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger
        data-testid={testId}
        className="flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function ProviderModelSelect({
  chat,
  adapters,
  adapter,
  model,
  runningModel = null,
  showCurrentModel = false,
  locked,
  disabled,
  providerDefaults,
  setAdapter,
  setModel,
  setModelTuning,
  setEffort,
  setFeature,
  hideProviderSwitch = false,
  switchBlockedReason = null,
  onSwitchProvider,
}: ProviderModelSelectProps) {
  const [open, setOpen] = useState(false);
  // Mid-session, a tab only browses: which provider's catalog the menu shows.
  const [browseId, setBrowseId] = useState<string | null>(null);
  if (adapters.length === 0) return null;

  const active = adapter ?? adapters.find((a) => a.installed) ?? adapters[0] ?? null;
  const currentModelId = model?.id ?? chat.model ?? '';
  const rows = modelRows(active, currentModelId);
  const { current, older, groups } = partitionModels(rows);
  const displayedModel = runningModel ?? model;
  const modelLabel =
    runningModel?.label ?? rows.find((m) => m.id === currentModelId)?.label ?? currentModelId ?? active?.name ?? '';
  // The trigger carries the resolved effort too ("Fable 5 · Medium") so the
  // dominant tuning field is readable without opening the menu. Models with no
  // effort axis show the bare name.
  const effortLabel =
    displayedModel != null && effortOptions(displayedModel).length > 0
      ? EFFORT_META[displayEffort(chat, displayedModel, providerDefaults).value].label
      : null;
  const triggerLabel = effortLabel != null ? `${modelLabel} · ${effortLabel}` : modelLabel;
  const activeId = chat.adapterId ?? active?.id ?? '';
  const shownId = locked ? (browseId ?? activeId) : activeId;
  const browsingOther = shownId !== activeId;
  const shown = browsingOther ? (adapters.find((a) => a.id === shownId) ?? active) : active;
  const catalog = browsingOther ? partitionModels(modelRows(shown, '')) : { current, older, groups };

  const onOpenChange = (next: boolean): void => {
    setOpen(next);
    if (!next) setBrowseId(null);
  };
  const onPickProvider = (id: string): void => {
    if (locked) setBrowseId(id);
    else if (id !== activeId) setAdapter(id);
  };
  const requestSwitch = (model: string, tuning?: SessionTuning): void => {
    onSwitchProvider?.({ adapterId: shownId, model, ...(tuning && { tuning }) });
    onOpenChange(false);
  };
  const onPickModel = (id: string): void => {
    if (browsingOther) return requestSwitch(id);
    if (id !== currentModelId) setModel(id);
    setOpen(false);
  };

  const renderRow = (m: AdapterModel) => (
    <ModelMenuRow
      key={m.id}
      option={m}
      active={!browsingOther && m.id === currentModelId}
      chat={chat}
      providerDefaults={providerDefaults}
      onSelect={onPickModel}
      setModelTuning={browsingOther ? requestSwitch : setModelTuning}
      setEffort={setEffort}
      setFeature={setFeature}
    />
  );

  return (
    <RunningHint active={disabled}>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <Hint label={modelSelectionHint(model, runningModel, showCurrentModel)} side="top">
          {/* Radix gates opening on the TRIGGER's own `disabled`; a disabled
              child button alone still lets pointerdown open the menu. */}
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              data-testid="composer-model-select"
              disabled={disabled}
              aria-label={`Provider and model: ${triggerLabel}`}
              className={cn(
                'flex h-[20px] min-w-0 items-center gap-[5px] rounded-[11px] border-[0.5px] border-border pl-[8px] pr-[7px] text-xs text-muted-foreground',
                'hover:bg-accent hover:text-accent-foreground',
                // Driven by state, not data-[state=open]: TooltipTrigger asChild
                // overwrites the child's data-state with the tooltip's own.
                open && 'border-primary bg-sidebar-selection',
                'transition-colors focus-visible:outline-none',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              <ProviderDot adapterId={activeId} testId="composer-model-provider-dot" />
              <span className="max-w-[150px] truncate font-medium @max-[560px]:max-w-[90px] @max-[430px]:max-w-[56px]">
                {triggerLabel}
              </span>
              <ChevronDown size={12} className="flex-shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
        </Hint>

        <DropdownMenuContent
          data-testid="composer-provider-model-popover"
          align="start"
          side="top"
          sideOffset={6}
          className="w-72"
        >
          {/* Non-item chrome holding real buttons — keystrokes stay here rather
              than driving the menu's typeahead. Escape still closes. Hidden
              entirely for a side chat (todo #344): its adapter is fixed. */}
          {!hideProviderSwitch && (
            <>
              <div
                className="p-1 pb-1.5"
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') e.stopPropagation();
                }}
              >
                <ProviderTabs
                  adapters={adapters}
                  selectedId={shownId}
                  activeId={activeId}
                  blockedReason={locked ? switchBlockedReason : null}
                  onSelect={onPickProvider}
                />
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          {(showCurrentModel || runningModel) && runningModel?.id !== model?.id && (
            <DropdownMenuLabel data-testid="composer-model-current" className="text-xs text-muted-foreground">
              Current: {runningModel?.label ?? 'unavailable'}
              <br />
              Selected: {model?.label ?? 'Use CLI setting'}
            </DropdownMenuLabel>
          )}

          {/* Fixed-height scroll region: every provider's catalog renders in
              the same panel size, so switching tabs or expanding a section
              scrolls instead of resizing the (bottom-anchored) menu. */}
          <div className="h-72 overflow-y-auto">
            <DropdownMenuLabel>{shown?.name ?? 'Models'} models</DropdownMenuLabel>
            {catalog.current.map(renderRow)}
            {catalog.older.length > 0 && (
              <CollapsibleModelSection
                label="Older models"
                testId="composer-model-older-header"
                containsCurrent={!browsingOther && catalog.older.some((m) => m.id === currentModelId)}
              >
                {catalog.older.map(renderRow)}
              </CollapsibleModelSection>
            )}
            {catalog.groups.map(([label, models]) => (
              <CollapsibleModelSection
                key={label}
                label={label}
                testId={`composer-model-group-header-${groupSlug(label)}`}
                containsCurrent={!browsingOther && models.some((m) => m.id === currentModelId)}
              >
                {models.map(renderRow)}
              </CollapsibleModelSection>
            ))}
          </div>

          <p data-testid="composer-provider-footer" className="px-2 pt-2 text-xs text-muted-foreground">
            {locked ? PROVIDER_SWITCH_FOOTER : PROVIDER_PICK_FOOTER}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </RunningHint>
  );
}
