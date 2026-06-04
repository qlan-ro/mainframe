import React from 'react';
import type { AdapterModel, ProviderConfig } from '@qlan-ro/mainframe-types';

const SUMMARY_OPTIONS = ['auto', 'concise', 'detailed', 'none'] as const;
const PERSONALITY_OPTIONS = ['none', 'friendly', 'pragmatic'] as const;

function SelectField({
  testId,
  value,
  options,
  onChange,
}: {
  testId: string;
  value: string | undefined;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      data-testid={testId}
      value={value ?? ''}
      className="w-full px-3 py-1.5 text-mf-small bg-mf-input-bg text-mf-text-primary border border-mf-border rounded-mf-input focus:outline-none focus:border-mf-accent"
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Inherit</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function CodexTuningDefaults({
  adapterId,
  model,
  config,
  onChange,
}: {
  adapterId: string;
  /** May be undefined when the adapter's model list hasn't loaded — reasoning-summary
   *  (model-agnostic) still renders; personality is gated on the model's capability. */
  model?: AdapterModel;
  config: ProviderConfig;
  onChange: (partial: Partial<ProviderConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      {model?.supportsPersonality && (
        <label className="block space-y-1.5">
          <span className="text-mf-small text-mf-text-secondary">Personality</span>
          <SelectField
            testId={`providers-${adapterId}-personality`}
            value={config.personality}
            options={PERSONALITY_OPTIONS}
            onChange={(v) => onChange({ personality: v as ProviderConfig['personality'] })}
          />
        </label>
      )}
      <label className="block space-y-1.5">
        <span className="text-mf-small text-mf-text-secondary">Reasoning Summary</span>
        <SelectField
          testId={`providers-${adapterId}-reasoning-summary`}
          value={config.reasoningSummary}
          options={SUMMARY_OPTIONS}
          onChange={(v) => onChange({ reasoningSummary: v as ProviderConfig['reasoningSummary'] })}
        />
      </label>
    </div>
  );
}
