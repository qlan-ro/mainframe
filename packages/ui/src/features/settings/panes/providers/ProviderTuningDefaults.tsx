import type { AdapterModel, EffortLevel, ProviderConfig, ProviderConfigUpdate } from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES } from '@qlan-ro/mainframe-types';
import { effortOptions, visibleFeatures } from '../../../../lib/model-tuning';
import { Switch } from '../../../../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';

const INHERIT = '__inherit__';

interface ProviderTuningDefaultsProps {
  adapterId: string;
  model: AdapterModel;
  config: ProviderConfig;
  onChange: (partial: ProviderConfigUpdate) => void;
}

/** Per-model effort and feature toggle defaults for a provider. Gated on model capabilities. */
export function ProviderTuningDefaults({ adapterId, model, config, onChange }: ProviderTuningDefaultsProps) {
  const efforts = effortOptions(model);
  const features = visibleFeatures(model);

  function providerDefaultKey(key: string): keyof ProviderConfig {
    const feature = TUNABLE_FEATURES.find((f) => f.key === key);
    return feature!.providerDefault as keyof ProviderConfig;
  }

  return (
    <div className="space-y-3">
      {efforts.length > 0 && (
        <label className="block space-y-1.5">
          <span className="text-label text-muted-foreground">Default Effort</span>
          <Select
            value={config.defaultEffort ?? INHERIT}
            onValueChange={(v) => onChange({ defaultEffort: (v === INHERIT ? '' : v) as EffortLevel | '' })}
          >
            <SelectTrigger data-testid={`settings-${adapterId}-default-effort`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT} data-testid={`settings-${adapterId}-default-effort-option-inherit`}>
                Inherit (model default)
              </SelectItem>
              {efforts.map((o) => (
                <SelectItem key={o.id} value={o.id} data-testid={`settings-${adapterId}-default-effort-option-${o.id}`}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      {features.map((f) => {
        const key = providerDefaultKey(f.key);
        return (
          <div key={f.key} className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <span className="text-body text-foreground">{f.label}</span>
              <p className="text-label text-muted-foreground">{f.desc}</p>
            </div>
            <Switch
              data-testid={`settings-${adapterId}-default-feature-${f.key}`}
              checked={config[key] === 'true'}
              onCheckedChange={(checked) => onChange({ [key]: checked ? 'true' : 'false' } as ProviderConfigUpdate)}
            />
          </div>
        );
      })}
    </div>
  );
}
