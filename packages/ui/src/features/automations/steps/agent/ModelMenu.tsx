/**
 * ModelMenu — the Agent card's model chip (todo #234 T15), fed by the live
 * `useAdapters()` catalog (kept fresh by `adapter.models.updated`, the same
 * source the composer's `ProviderModelSelect` reads).
 *
 * One menu grouped by provider, rather than a provider select plus a model
 * select: a pick always names its provider, so `adapterId` and `model` can't
 * drift apart, and the toolbar spends one chip instead of two.
 */
import { Sparkles } from 'lucide-react';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@v2/components/ui/dropdown-menu';
import { useAdapters } from '@/store/adapters';
import type { AskAgentStep } from '../../contract';
import { ChipButton } from './ChipButton';

export interface ModelMenuProps {
  adapterId: string | undefined;
  model: string | undefined;
  onChange: (patch: Pick<AskAgentStep, 'adapterId' | 'model'>) => void;
  testId: string;
}

function resolveAdapter(adapters: AdapterInfo[], adapterId: string | undefined): AdapterInfo | undefined {
  return adapters.find((a) => a.id === adapterId) ?? adapters.find((a) => a.installed) ?? adapters[0];
}

function resolveModel(adapter: AdapterInfo | undefined, model: string | undefined) {
  const models = adapter?.models ?? [];
  return models.find((m) => m.id === model) ?? models.find((m) => m.isDefault) ?? models[0];
}

export function ModelMenu({ adapterId, model, onChange, testId }: ModelMenuProps) {
  const adapters = useAdapters();
  const activeAdapter = resolveAdapter(adapters, adapterId);
  const activeModel = resolveModel(activeAdapter, model);

  if (!activeAdapter || !activeModel) {
    return (
      <ChipButton icon={Sparkles} label="No agent providers installed" testId={`${testId}-model`} disabled>
        No agents
      </ChipButton>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChipButton
          icon={Sparkles}
          label={`Model: ${activeAdapter.name} · ${activeModel.label}`}
          testId={`${testId}-model`}
          chevron
          className="min-w-0"
        >
          <span className="truncate">{activeModel.label}</span>
        </ChipButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-testid={`${testId}-model-menu`}
        align="start"
        sideOffset={6}
        className="max-h-[320px] min-w-44 overflow-y-auto"
      >
        {adapters.map((a) => (
          <div key={a.id}>
            <DropdownMenuLabel>{a.name}</DropdownMenuLabel>
            {a.models.map((m) => (
              <DropdownMenuItem
                key={m.id}
                data-testid={`${testId}-model-option-${a.id}-${m.id}`}
                onSelect={() => onChange({ adapterId: a.id, model: m.id })}
                className={
                  a.id === activeAdapter.id && m.id === activeModel.id ? 'bg-sidebar-selection font-medium' : ''
                }
              >
                {m.label}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
