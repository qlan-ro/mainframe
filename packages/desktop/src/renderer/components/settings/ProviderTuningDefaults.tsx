import type { AdapterModel, EffortLevel, ProviderConfig, ProviderConfigUpdate } from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES } from '@qlan-ro/mainframe-types';
import { Toggle } from '../ui/toggle';
import { effortOptions, visibleFeatures } from '../../lib/model-tuning';

export function ProviderTuningDefaults({
  adapterId,
  model,
  config,
  onChange,
}: {
  adapterId: string;
  model: AdapterModel;
  config: ProviderConfig;
  onChange: (partial: ProviderConfigUpdate) => void;
}) {
  const efforts = effortOptions(model);
  const features = visibleFeatures(model);

  const providerDefaultKey = (key: string): keyof ProviderConfig => {
    const feature = TUNABLE_FEATURES.find((f) => f.key === key);
    return feature!.providerDefault as keyof ProviderConfig;
  };

  return (
    <div className="space-y-3">
      {efforts.length > 0 && (
        <label className="block space-y-1.5">
          <span className="text-mf-small text-mf-text-secondary">Default Effort</span>
          <select
            data-testid={`providers-${adapterId}-default-effort`}
            value={config.defaultEffort ?? ''}
            // Send the raw value: '' is the clear sentinel the route deletes on
            // (→ chat inherits the model default). Don't coerce to undefined, which
            // JSON.stringify would omit, making the clear unreachable.
            onChange={(e) => onChange({ defaultEffort: e.target.value as EffortLevel | '' })}
            className="w-full px-3 py-1.5 text-mf-small bg-mf-input-bg text-mf-text-primary border border-mf-border rounded-mf-input focus:outline-none focus:border-mf-accent"
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
          <label key={f.key} className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <span className="text-mf-small text-mf-text-primary">{f.label}</span>
              <p className="text-mf-status text-mf-text-secondary">{f.desc}</p>
            </div>
            <Toggle
              data-testid={`providers-${adapterId}-default-feature-${f.key}`}
              checked={config[key] === 'true'}
              onChange={(v) => onChange({ [key]: v ? 'true' : 'false' } as ProviderConfigUpdate)}
            />
          </label>
        );
      })}
    </div>
  );
}
