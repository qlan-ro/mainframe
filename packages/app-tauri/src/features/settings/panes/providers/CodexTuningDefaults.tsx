import type { AdapterModel, ProviderConfig, ProviderConfigUpdate } from '@qlan-ro/mainframe-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';

const SUMMARY_OPTIONS = ['auto', 'concise', 'detailed', 'none'] as const;
const PERSONALITY_OPTIONS = ['none', 'friendly', 'pragmatic'] as const;
const INHERIT = '__inherit__';

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
    <Select value={value ?? INHERIT} onValueChange={(v) => onChange(v === INHERIT ? '' : v)}>
      <SelectTrigger data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT} data-testid={`${testId}-option-inherit`}>
          Inherit
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o} data-testid={`${testId}-option-${o}`}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface CodexTuningDefaultsProps {
  adapterId: string;
  /** May be undefined when the adapter's model list hasn't loaded — reasoning-summary
   *  (model-agnostic) still renders; personality is gated on the model's capability. */
  model?: AdapterModel;
  config: ProviderConfig;
  onChange: (partial: ProviderConfigUpdate) => void;
}

/** Codex-specific tuning: personality (model-gated) and reasoning summary (always). */
export function CodexTuningDefaults({ adapterId, model, config, onChange }: CodexTuningDefaultsProps) {
  return (
    <div className="space-y-3">
      {model?.supportsPersonality && (
        <label className="block space-y-1.5">
          <span className="text-label text-muted-foreground">Personality</span>
          <SelectField
            testId={`settings-${adapterId}-personality`}
            value={config.personality}
            options={PERSONALITY_OPTIONS}
            onChange={(v) => onChange({ personality: v as ProviderConfigUpdate['personality'] })}
          />
        </label>
      )}
      <label className="block space-y-1.5">
        <span className="text-label text-muted-foreground">Reasoning Summary</span>
        <SelectField
          testId={`settings-${adapterId}-reasoning-summary`}
          value={config.reasoningSummary}
          options={SUMMARY_OPTIONS}
          onChange={(v) => onChange({ reasoningSummary: v as ProviderConfigUpdate['reasoningSummary'] })}
        />
      </label>
    </div>
  );
}
