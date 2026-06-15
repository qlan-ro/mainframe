import { MODE_OPTIONS } from '../../settings-tabs';
import type { ProviderConfig, ProviderConfigUpdate } from '@qlan-ro/mainframe-types';

interface SessionModeRadioProps {
  adapterId: string;
  config: ProviderConfig;
  onChange: (patch: ProviderConfigUpdate) => void;
}

/** Three-option radio group for the provider's default session mode. */
export function SessionModeRadio({ adapterId, config, onChange }: SessionModeRadioProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-label text-mf-text-secondary">Default Session Mode</label>
      <div className="space-y-1">
        {MODE_OPTIONS.map((mode) => (
          <label
            key={mode.id}
            className="flex items-start gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-mf-hover transition-colors"
          >
            <input
              data-testid={`settings-${adapterId}-mode-option-${mode.id}`}
              type="radio"
              name={`${adapterId}-mode`}
              checked={(config.defaultMode ?? 'default') === mode.id}
              onChange={() => onChange({ defaultMode: mode.id })}
              className={`h-4 w-4 shrink-0 m-0 ${mode.danger ? 'accent-mf-destructive' : 'accent-mf-accent'}`}
              style={{ marginTop: 'calc((1.125rem - 1rem) / 2)' }}
            />
            <div className="flex-1">
              <span className={`text-body ${mode.danger ? 'text-red-400' : 'text-mf-text-primary'}`}>{mode.label}</span>
              <p className="text-label text-mf-text-secondary">{mode.description}</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
