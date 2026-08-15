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
} from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/hint';
import { useAdapters } from '@/store/adapters';
import type { AskAgentStep } from '../../contract';
import { ChipButton } from './ChipButton';
import { resolveStepAdapter } from './resolve-step-adapter';

export interface ModelMenuProps {
  adapterId: string | undefined;
  model: string | undefined;
  onChange: (patch: Pick<AskAgentStep, 'adapterId' | 'model'>) => void;
  testId: string;
}

function resolveModel(adapter: AdapterInfo | undefined, model: string | undefined) {
  const models = adapter?.models ?? [];
  return models.find((m) => m.id === model) ?? models.find((m) => m.isDefault) ?? models[0];
}

export function ModelMenu({ adapterId, model, onChange, testId }: ModelMenuProps) {
  const adapters = useAdapters();
  const activeAdapter = resolveStepAdapter(adapters, adapterId);
  const activeModel = resolveModel(activeAdapter, model);

  // A disabled button swallows pointer events, so the hint wraps the chip rather than triggering on it.
  if (!activeAdapter || !activeModel) {
    return (
      <Hint label="No agent providers installed">
        <span className="inline-flex shrink-0">
          <ChipButton icon={Sparkles} label="No agent providers installed" testId={`${testId}-model`} disabled>
            No agents
          </ChipButton>
        </span>
      </Hint>
    );
  }

  const label = `Model: ${activeAdapter.name} · ${activeModel.label}`;

  return (
    <DropdownMenu>
      {/* Hint WRAPS the trigger — inside it, TooltipTrigger's asChild would
          swallow the menu's own ref and onClick. */}
      <Hint label={label}>
        <DropdownMenuTrigger asChild>
          <ChipButton icon={Sparkles} label={label} testId={`${testId}-model`} chevron className="min-w-0">
            <span className="truncate">{activeModel.label}</span>
          </ChipButton>
        </DropdownMenuTrigger>
      </Hint>
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
