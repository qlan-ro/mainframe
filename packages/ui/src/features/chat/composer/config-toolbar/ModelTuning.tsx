'use client';

/**
 * The selected model's effort, as an inline segment, and its options below
 * (C5). Every control keeps the menu open, so several can be set in one visit.
 */

import type { AdapterModel, Chat, EffortLevel, FeatureKey, ProviderConfig } from '@qlan-ro/mainframe-types';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { displayEffort, effectiveFeature, effortOptions, visibleFeatures } from '@/lib/model-tuning';

export interface ModelTuningProps {
  model: AdapterModel;
  chat: Chat;
  providerDefaults?: ProviderConfig;
  setEffort: (effort: EffortLevel) => void;
  setFeature: (key: FeatureKey, on: boolean) => void;
}

const keepOpen = (event: Event) => event.preventDefault();

export function ModelTuning({ model, chat, providerDefaults, setEffort, setFeature }: ModelTuningProps) {
  const efforts = effortOptions(model);
  const features = visibleFeatures(model);
  if (efforts.length === 0 && features.length === 0) return null;
  const { value: effort, locked } = displayEffort(chat, model, providerDefaults);

  return (
    <div data-testid={`composer-model-${model.id}-tuning`}>
      <DropdownMenuSeparator />
      {efforts.length > 0 && (
        <>
          <DropdownMenuLabel>Effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={effort}
            onValueChange={(level) => setEffort(level as EffortLevel)}
            className="flex gap-0.5 px-1 pt-0.5 pb-1"
          >
            {efforts.map((level) => (
              <DropdownMenuRadioItem
                key={level.id}
                value={level.id}
                data-testid={`composer-model-${model.id}-effort-${level.id}`}
                disabled={locked}
                onSelect={keepOpen}
                className={cn(
                  'min-h-7 min-w-0 flex-1 justify-center rounded-[7px] px-1.5 py-1 text-center text-small/[20px] font-medium whitespace-nowrap',
                  // The segment's fill says which is on; the radio item's own check would push the label off-centre.
                  '[&>span:has(svg)]:hidden data-[state=checked]:bg-chrome-selected',
                )}
              >
                {level.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </>
      )}
      {features.map((f) => {
        const on = effectiveFeature(chat, providerDefaults, f.key);
        return (
          <DropdownMenuCheckboxItem
            key={f.key}
            data-testid={`composer-model-${model.id}-feature-${f.key}`}
            checked={on}
            onSelect={(e) => {
              e.preventDefault();
              setFeature(f.key, !on);
            }}
          >
            {f.label}
          </DropdownMenuCheckboxItem>
        );
      })}
    </div>
  );
}
