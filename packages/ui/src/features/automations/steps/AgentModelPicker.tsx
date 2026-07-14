/**
 * AgentModelPicker — two-tier provider→model picker for the Agent step
 * config (todo #234 bullet 7), replacing the flat hardcoded `AGENT_MODELS`
 * list with the live `useAdapters()` catalog (kept fresh by
 * `adapter.models.updated`, same source the real composer's
 * `ProviderModelSelect` reads). Mirrors that component's two-tier shape —
 * pick the provider, then a model scoped to it — as two compact native
 * selects rather than a popover: this step-config panel is small, and every
 * neighboring control here (`MiniSelect`) is already a plain `<select>`.
 *
 * Not built on the frozen `fields/MiniSelect` (value-is-label only) since a
 * provider/model each need a distinct id vs. display label.
 */
import { ChevronDown } from 'lucide-react';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { useAdapters } from '@/store/adapters';

export interface AgentModelPickerProps {
  adapterId: string | undefined;
  model: string | undefined;
  onAdapterChange: (adapterId: string) => void;
  onModelChange: (model: string) => void;
  testId: string;
}

interface LabeledOption {
  value: string;
  label: string;
}

function LabeledSelect({
  value,
  options,
  onChange,
  testId,
}: {
  value: string;
  options: LabeledOption[];
  onChange: (next: string) => void;
  testId: string;
}) {
  return (
    <span className="relative inline-flex" style={{ width: 150 }}>
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[30px] w-full appearance-none rounded-md border-[0.5px] border-input bg-card py-0 pl-[10px] pr-[24px] text-caption text-foreground outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-[9px] top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </span>
  );
}

function resolveAdapter(adapters: AdapterInfo[], adapterId: string | undefined): AdapterInfo | undefined {
  return adapters.find((a) => a.id === adapterId) ?? adapters.find((a) => a.installed) ?? adapters[0];
}

function resolveModelId(adapter: AdapterInfo | undefined, model: string | undefined): string {
  const models = adapter?.models ?? [];
  if (model && models.some((m) => m.id === model)) return model;
  return (models.find((m) => m.isDefault) ?? models[0])?.id ?? '';
}

export function AgentModelPicker({ adapterId, model, onAdapterChange, onModelChange, testId }: AgentModelPickerProps) {
  const adapters = useAdapters();
  if (adapters.length === 0) {
    return <span className="text-caption text-muted-foreground">No agent providers installed.</span>;
  }

  const activeAdapter = resolveAdapter(adapters, adapterId);
  const activeModelId = resolveModelId(activeAdapter, model);

  return (
    <div className="flex items-center gap-[8px]">
      <LabeledSelect
        testId={`${testId}-provider`}
        value={activeAdapter?.id ?? ''}
        options={adapters.map((a) => ({ value: a.id, label: a.name }))}
        onChange={onAdapterChange}
      />
      <LabeledSelect
        testId={`${testId}-model`}
        value={activeModelId}
        options={(activeAdapter?.models ?? []).map((m) => ({ value: m.id, label: m.label }))}
        onChange={onModelChange}
      />
    </div>
  );
}
