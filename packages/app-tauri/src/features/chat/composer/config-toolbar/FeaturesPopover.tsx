'use client';

/**
 * FeaturesPopover — gear trigger → popover of Switch toggles for Fast/Ultracode/AdaptiveThinking.
 *
 * Renders NULL when the model exposes no tunable features (e.g. Haiku).
 * Each toggle writes ONLY the touched field (ultracode→xhigh coercion is a daemon resolver
 * invariant, NOT a UI concern — we do NOT also write effort here).
 *
 * Built on shadcn Popover + Switch (not raw Radix) per the component-map contract.
 * Uses real mf-* tokens; never the /opacity modifier.
 */

import { SlidersHorizontal } from 'lucide-react';
import type { AdapterModel, Chat, FeatureKey } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { visibleFeatures, effectiveFeature } from '@/lib/model-tuning';

export interface FeaturesPopoverProps {
  chat: Chat;
  model: AdapterModel;
  setFeature: (key: FeatureKey, on: boolean) => void;
  disabled: boolean;
}

interface FeatureRowProps {
  featureKey: FeatureKey;
  label: string;
  desc: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (key: FeatureKey, on: boolean) => void;
}

function FeatureRow({ featureKey, label, desc, checked, disabled, onToggle }: FeatureRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-label font-medium text-foreground">{label}</div>
        <div className="text-caption text-muted-foreground leading-snug">{desc}</div>
      </div>
      <Switch
        data-testid={`composer-feature-${featureKey}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(on) => onToggle(featureKey, on)}
        aria-label={label}
      />
    </div>
  );
}

export function FeaturesPopover({ chat, model, setFeature, disabled }: FeaturesPopoverProps) {
  // Provider defaults not yet fetched in app-tauri — pass undefined.
  const features = visibleFeatures(model);

  // Hidden entirely when the model exposes no tunable features.
  if (features.length === 0) return null;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="composer-features-trigger"
              disabled={disabled}
              aria-label="Feature settings"
              className={[
                'flex items-center justify-center px-2 py-1',
                'rounded-md text-muted-foreground',
                'hover:bg-accent hover:text-accent-foreground',
                'transition-colors',
                'disabled:pointer-events-none',
                'disabled:opacity-40',
                'focus-visible:outline-none',
              ].join(' ')}
            >
              <SlidersHorizontal size={14} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Feature settings</TooltipContent>
      </Tooltip>

      <PopoverContent
        data-testid="composer-features-popover"
        align="start"
        side="top"
        sideOffset={6}
        className="w-64 p-3"
      >
        <p className="mb-2 text-label font-semibold text-foreground">Features</p>
        <div className="divide-y divide-border">
          {features.map((f) => (
            <FeatureRow
              key={f.key}
              featureKey={f.key}
              label={f.label}
              desc={f.desc}
              checked={effectiveFeature(chat, undefined, f.key)}
              disabled={disabled}
              onToggle={setFeature}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
