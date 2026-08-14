import { MODE_OPTIONS } from '../../settings-tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import type { AdapterInfo, ProviderConfig, ProviderConfigUpdate } from '@qlan-ro/mainframe-types';

interface SessionModeRadioProps {
  adapterId: string;
  adapter: AdapterInfo;
  config: ProviderConfig;
  onChange: (patch: ProviderConfigUpdate) => void;
}

/** Radio group for the provider's default session mode.
 *  Auto is offered only for adapters advertising the `autoMode` capability. */
export function SessionModeRadio({ adapterId, adapter, config, onChange }: SessionModeRadioProps) {
  const modes = MODE_OPTIONS.filter((m) => m.id !== 'auto' || adapter.capabilities.autoMode === true);
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground">Default Session Mode</Label>
      <RadioGroup
        value={config.defaultMode ?? 'default'}
        onValueChange={(v) => onChange({ defaultMode: v as NonNullable<ProviderConfig['defaultMode']> })}
        className="gap-1"
      >
        {modes.map((mode) => (
          <label
            key={mode.id}
            className="flex items-start gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors"
          >
            <RadioGroupItem
              data-testid={`settings-${adapterId}-mode-option-${mode.id}`}
              value={mode.id}
              className={`mt-0.5 ${itemToneClass(mode)}`}
            />
            <div className="flex-1">
              <span className={`text-sm ${labelToneClass(mode)}`}>{mode.label}</span>
              <p className="text-xs text-muted-foreground">{mode.description}</p>
            </div>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

type ModeOption = (typeof MODE_OPTIONS)[number];

/** The indicator dot is hard-coded `fill-primary` in the primitive, so a tinted
 *  ring needs the matching fill override or the two inks disagree. */
function itemToneClass(mode: ModeOption): string {
  if (mode.danger) return 'border-destructive/50 text-destructive [&_svg]:fill-destructive';
  if (mode.caution) return 'border-warning/50 text-warning [&_svg]:fill-warning';
  return '';
}

function labelToneClass(mode: ModeOption): string {
  if (mode.danger) return 'text-destructive';
  if (mode.caution) return 'text-warning';
  return 'text-foreground';
}
