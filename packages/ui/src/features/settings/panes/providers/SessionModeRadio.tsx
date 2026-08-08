import { MODE_OPTIONS } from '../../settings-tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import type { ProviderConfig, ProviderConfigUpdate } from '@qlan-ro/mainframe-types';

interface SessionModeRadioProps {
  adapterId: string;
  config: ProviderConfig;
  onChange: (patch: ProviderConfigUpdate) => void;
}

/** Three-option radio group for the provider's default session mode. */
export function SessionModeRadio({ adapterId, config, onChange }: SessionModeRadioProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground">Default Session Mode</Label>
      <RadioGroup
        value={config.defaultMode ?? 'default'}
        onValueChange={(v) => onChange({ defaultMode: v as NonNullable<ProviderConfig['defaultMode']> })}
        className="gap-1"
      >
        {MODE_OPTIONS.map((mode) => (
          <label
            key={mode.id}
            className="flex items-start gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors"
          >
            <RadioGroupItem
              data-testid={`settings-${adapterId}-mode-option-${mode.id}`}
              value={mode.id}
              className={`mt-0.5 ${mode.danger ? 'border-destructive/50 text-destructive [&_svg]:fill-destructive' : ''}`}
            />
            <div className="flex-1">
              <span className={`text-sm ${mode.danger ? 'text-destructive' : 'text-foreground'}`}>{mode.label}</span>
              <p className="text-xs text-muted-foreground">{mode.description}</p>
            </div>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}
