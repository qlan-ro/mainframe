'use client';

/**
 * ModelMenuRow — one model in the composer's model menu.
 *
 * The Cursor pattern: CLICK the row to choose the model, HOVER (or ArrowRight)
 * to open a flyout carrying that model's own tuning — its supported effort
 * levels and its tunable options. A model exposing neither renders as a plain
 * item with no flyout at all (Haiku).
 *
 * Effort and option controls `preventDefault()` on select so the menu survives
 * the write — you can set an effort and keep reading the list.
 *
 * A NON-ACTIVE model's flyout previews that model's resolved defaults, and
 * touching a control SWITCHES to the model with that tuning applied — one
 * compound write through `setModelTuning`, which parks a single guarded change
 * (model PATCH + tuning PATCH in one closure) so the mid-session gate can
 * never drop half the gesture.
 */

import { Check } from 'lucide-react';
import type {
  AdapterModel,
  Chat,
  EffortLevel,
  FeatureKey,
  ProviderConfig,
  SessionTuning,
} from '@qlan-ro/mainframe-types';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { displayEffort, effectiveFeature, effortOptions, visibleFeatures } from '@/lib/model-tuning';

/** Stands in for the chat when previewing a model the session hasn't selected. */
const NO_CHAT_TUNING = {};

export interface ModelMenuRowProps {
  option: AdapterModel;
  active: boolean;
  chat: Chat;
  providerDefaults?: ProviderConfig;
  onSelect: (id: string) => void;
  setModelTuning: (model: string, tuning: SessionTuning) => void;
  setEffort: (effort: EffortLevel) => void;
  setFeature: (key: FeatureKey, on: boolean) => void;
}

function rowDescription(option: AdapterModel): string | undefined {
  if (!option.isDefault) return option.description;
  return option.description ? `${option.description} · default` : 'default';
}

/** Name + description + the selected check — shared by the plain and flyout rows. */
function ModelRowBody({ option, active }: { option: AdapterModel; active: boolean }) {
  const desc = rowDescription(option);
  return (
    <>
      <Check className={cn('mt-0.5 size-3.5 shrink-0 text-primary', !active && 'invisible')} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{option.label}</span>
        {desc && <span className="block text-xs leading-snug text-muted-foreground">{desc}</span>}
      </span>
    </>
  );
}

export function ModelMenuRow({
  option,
  active,
  chat,
  providerDefaults,
  onSelect,
  setModelTuning,
  setEffort,
  setFeature,
}: ModelMenuRowProps) {
  const efforts = effortOptions(option);
  const features = visibleFeatures(option);
  const testId = `composer-model-select-option-${option.id}`;

  if (efforts.length === 0 && features.length === 0) {
    return (
      <DropdownMenuItem data-testid={testId} className="items-start" onSelect={() => onSelect(option.id)}>
        <ModelRowBody option={option} active={active} />
      </DropdownMenuItem>
    );
  }

  // An unselected model previews its own defaults rather than the chat's tuning.
  const tuningSource = active ? chat : NO_CHAT_TUNING;
  const { value: effort, locked } = displayEffort(tuningSource, option, providerDefaults);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        data-testid={testId}
        className="items-start"
        onClick={() => onSelect(option.id)}
        aria-label={option.label}
      >
        <ModelRowBody option={option} active={active} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent data-testid={`composer-model-${option.id}-tuning`} className="w-56">
        {efforts.length > 0 && (
          <>
            <DropdownMenuLabel>Effort</DropdownMenuLabel>
            {efforts.map((level) => (
              <DropdownMenuCheckboxItem
                key={level.id}
                data-testid={`composer-model-${option.id}-effort-${level.id}`}
                checked={level.id === effort}
                disabled={locked}
                onSelect={(e) => {
                  e.preventDefault();
                  if (active) setEffort(level.id as EffortLevel);
                  else setModelTuning(option.id, { effort: level.id as EffortLevel });
                }}
              >
                {level.label}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
        {features.length > 0 && (
          <>
            {efforts.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>Options</DropdownMenuLabel>
            {features.map((f) => (
              <DropdownMenuCheckboxItem
                key={f.key}
                data-testid={`composer-model-${option.id}-feature-${f.key}`}
                checked={effectiveFeature(tuningSource, providerDefaults, f.key)}
                onSelect={(e) => {
                  e.preventDefault();
                  const next = !effectiveFeature(tuningSource, providerDefaults, f.key);
                  if (active) setFeature(f.key, next);
                  else setModelTuning(option.id, { [f.key]: next });
                }}
              >
                {f.label}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
