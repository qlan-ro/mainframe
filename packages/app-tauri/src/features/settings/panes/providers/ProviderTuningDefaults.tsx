import type { AdapterModel, EffortLevel, ProviderConfig, ProviderConfigUpdate } from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES } from '@qlan-ro/mainframe-types';
import { effortOptions, visibleFeatures } from '../../../../lib/model-tuning';

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
          <span className="text-label text-mf-text-secondary">Default Effort</span>
          <select
            data-testid={`settings-${adapterId}-default-effort`}
            value={config.defaultEffort ?? ''}
            onChange={(e) => onChange({ defaultEffort: e.target.value as EffortLevel | '' })}
            className="w-full px-3 py-1.5 text-body bg-mf-input-bg text-mf-text-primary border border-mf-border rounded-md focus:outline-none focus:border-mf-accent"
          >
            <option value="">Inherit (model default)</option>
            {efforts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {features.map((f) => {
        const key = providerDefaultKey(f.key);
        return (
          <div key={f.key} className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <span className="text-body text-mf-text-primary">{f.label}</span>
              <p className="text-label text-mf-text-secondary">{f.desc}</p>
            </div>
            <input
              data-testid={`settings-${adapterId}-default-feature-${f.key}`}
              type="checkbox"
              checked={config[key] === 'true'}
              onChange={(e) => onChange({ [key]: e.target.checked ? 'true' : 'false' } as ProviderConfigUpdate)}
              className="h-4 w-4 accent-mf-accent"
            />
          </div>
        );
      })}
    </div>
  );
}
