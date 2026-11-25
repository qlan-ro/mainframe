'use client';

/**
 * The model menu's body: provider tabs, the shown provider's models, then the
 * selected model's effort and options. Shared by the model control and the
 * combined chip that replaces it in a narrow composer (C6).
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  AdapterInfo,
  AdapterModel,
  Chat,
  EffortLevel,
  FeatureKey,
  ProviderConfig,
} from '@qlan-ro/mainframe-types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { displayEffort, effortOptions, EFFORT_META } from '@/lib/model-tuning';
import { ModelMenuRow } from './ModelMenuRow';
import { ModelTuning } from './ModelTuning';
import { groupSlug, modelRows, partitionModels } from './model-menu-rows';
import { PROVIDER_PICK_FOOTER, PROVIDER_SWITCH_FOOTER } from './provider-switch';
import { ProviderTabs } from './ProviderTabs';
import type { ProviderSwitchRequest } from './use-provider-switch';

export interface ModelMenuProps {
  chat: Chat;
  adapters: AdapterInfo[];
  /** The resolved active adapter (chat's adapter, else default). */
  adapter: AdapterInfo | null;
  model: AdapterModel | null;
  runningModel?: AdapterModel | null;
  showCurrentModel?: boolean;
  /** True once the chat has messages: a provider tab then browses its catalog,
   *  and picking one of its models switches the chat in place. */
  locked: boolean;
  /** Why switching providers is unavailable right now (shown on the tabs), or null. */
  switchBlockedReason?: string | null;
  onSwitchProvider?: (request: ProviderSwitchRequest) => void;
  providerDefaults?: ProviderConfig;
  setAdapter: (adapterId: string) => void;
  setModel: (model: string) => void;
  setEffort: (effort: EffortLevel) => void;
  setFeature: (key: FeatureKey, on: boolean) => void;
  /** Hides the provider tabs (side chats: the adapter is a copy of the parent's). */
  hideProviderSwitch?: boolean;
}

interface ActiveModel {
  activeId: string;
  active: AdapterInfo | null;
  currentModelId: string;
  modelLabel: string;
  /** Null for a model with no effort axis. */
  effortLabel: string | null;
}

/** What the trigger reads, and the menu's starting point. */
export function activeModel({
  chat,
  adapters,
  adapter,
  model,
  runningModel = null,
  providerDefaults,
}: ModelMenuProps): ActiveModel {
  const active = adapter ?? adapters.find((a) => a.installed) ?? adapters[0] ?? null;
  const currentModelId = model?.id ?? chat.model ?? '';
  const displayed = runningModel ?? model;
  const modelLabel =
    runningModel?.label ??
    modelRows(active, currentModelId).find((m) => m.id === currentModelId)?.label ??
    (currentModelId || (active?.name ?? ''));
  const effortLabel =
    displayed != null && effortOptions(displayed).length > 0
      ? EFFORT_META[displayEffort(chat, displayed, providerDefaults).value].label
      : null;
  return { activeId: chat.adapterId ?? active?.id ?? '', active, currentModelId, modelLabel, effortLabel };
}

interface ModelSectionProps {
  label: string;
  testId: string;
  /** A section holding the checked model starts open — the selection must never load hidden. */
  containsCurrent: boolean;
  children: ReactNode;
}

/** Secondary model sections (Older models, catalog groups) fold away by default. */
function CollapsibleModelSection({ label, testId, containsCurrent, children }: ModelSectionProps) {
  const [expanded, setExpanded] = useState(containsCurrent);
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger
        data-testid={testId}
        className="flex w-full items-center gap-1 rounded-sm px-2.5 py-1.5 text-meta/[1.45] font-medium text-muted-foreground hover:text-foreground focus-visible:focus-line-inset"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function ModelMenu({ onClose, ...props }: ModelMenuProps & { onClose: () => void }) {
  const { chat, adapters, model, runningModel = null, showCurrentModel = false, locked, providerDefaults } = props;
  // Mid-session, a tab only browses: which provider's catalog the menu shows.
  const [browseId, setBrowseId] = useState<string | null>(null);
  const { activeId, active, currentModelId } = activeModel(props);
  const shownId = locked ? (browseId ?? activeId) : activeId;
  const browsingOther = shownId !== activeId;
  const shown = browsingOther ? (adapters.find((a) => a.id === shownId) ?? active) : active;
  const catalog = partitionModels(modelRows(shown, browsingOther ? '' : currentModelId));
  const tuned = browsingOther ? null : model;

  const onPickModel = (id: string): void => {
    if (browsingOther) props.onSwitchProvider?.({ adapterId: shownId, model: id });
    else if (id !== currentModelId) props.setModel(id);
    onClose();
  };
  const renderRow = (m: AdapterModel) => (
    <ModelMenuRow key={m.id} option={m} active={!browsingOther && m.id === currentModelId} onSelect={onPickModel} />
  );
  const holdsCurrent = (models: AdapterModel[]) => !browsingOther && models.some((m) => m.id === currentModelId);

  return (
    <>
      {/* Non-item chrome holding real buttons — keystrokes stay here rather than
          driving the menu's typeahead. Escape still closes. */}
      {!props.hideProviderSwitch && (
        <>
          <div
            className="px-1.5 pt-1 pb-1.5"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') e.stopPropagation();
            }}
          >
            <ProviderTabs
              adapters={adapters}
              selectedId={shownId}
              activeId={activeId}
              blockedReason={locked ? (props.switchBlockedReason ?? null) : null}
              onSelect={(id) => {
                if (locked) setBrowseId(id);
                else if (id !== activeId) props.setAdapter(id);
              }}
            />
            {locked && props.switchBlockedReason && (
              <p data-testid="composer-provider-blocked" className="px-1 pt-1.5 text-meta/[1.45] text-muted-foreground">
                {props.switchBlockedReason}
              </p>
            )}
          </div>
        </>
      )}
      {(showCurrentModel || runningModel) && runningModel?.id !== model?.id && (
        <DropdownMenuLabel data-testid="composer-model-current">
          Current: {runningModel?.label ?? 'unavailable'}
          <br />
          Selected: {model?.label ?? 'Use CLI setting'}
        </DropdownMenuLabel>
      )}

      {/* A capped scroll region, so a long catalog scrolls instead of growing the
          bottom-anchored menu. */}
      <div className="max-h-64 overflow-y-auto">
        <DropdownMenuLabel>{shown?.name ?? 'Models'} models</DropdownMenuLabel>
        {catalog.current.map(renderRow)}
        {catalog.older.length > 0 && (
          <CollapsibleModelSection
            label="Older models"
            testId="composer-model-older-header"
            containsCurrent={holdsCurrent(catalog.older)}
          >
            {catalog.older.map(renderRow)}
          </CollapsibleModelSection>
        )}
        {catalog.groups.map(([label, models]) => (
          <CollapsibleModelSection
            key={label}
            label={label}
            testId={`composer-model-group-header-${groupSlug(label)}`}
            containsCurrent={holdsCurrent(models)}
          >
            {models.map(renderRow)}
          </CollapsibleModelSection>
        ))}
      </div>

      {tuned && (
        <ModelTuning
          model={tuned}
          chat={chat}
          providerDefaults={providerDefaults}
          setEffort={props.setEffort}
          setFeature={props.setFeature}
        />
      )}
      {!props.hideProviderSwitch && (
        <p data-testid="composer-provider-footer" className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
          {locked ? PROVIDER_SWITCH_FOOTER : PROVIDER_PICK_FOOTER}
        </p>
      )}
    </>
  );
}
