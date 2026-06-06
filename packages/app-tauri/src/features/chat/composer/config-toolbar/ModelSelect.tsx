'use client';

/**
 * ModelSelect — compact DropdownMenu of models available on the current adapter.
 *
 * Renders NULL when the adapter exposes 0 or 1 models (nothing to choose).
 * NOT disabled while the chat is running — the user may switch model for the
 * next turn.
 *
 * If the chat carries a stored model id that is not in the adapter's catalog
 * (e.g. a legacy or tier-specific id), a synthetic entry is injected so the
 * trigger and list still display a readable label — mirrors the desktop invariant.
 *
 * Built on shadcn DropdownMenu; never raw Radix.
 * Token rule: no /opacity modifier on hex CSS-var colors.
 */

import type { AdapterInfo, AdapterModel, Chat } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface ModelSelectProps {
  chat: Chat;
  adapter: AdapterInfo;
  model: AdapterModel | null;
  setModel: (model: string) => void;
}

/** Builds the display list, injecting a synthetic entry for unknown stored ids. */
function buildOptions(
  catalogModels: AdapterModel[],
  storedId: string | null | undefined,
): { id: string; label: string }[] {
  const hasstored = storedId != null && storedId !== '';
  const inCatalog = hasstored && catalogModels.some((m) => m.id === storedId);
  if (hasstored && !inCatalog) {
    // Synthetic entry — stored id not yet in the probed catalog.
    return [{ id: storedId, label: storedId }, ...catalogModels];
  }
  return catalogModels;
}

export function ModelSelect({ chat, adapter, model, setModel }: ModelSelectProps) {
  const catalogModels = adapter.models;

  // Nothing to pick when there is only one (or zero) option.
  if (catalogModels.length <= 1) return null;

  const options = buildOptions(catalogModels, chat.model);
  const currentId = model?.id ?? chat.model ?? '';
  const triggerLabel = options.find((o) => o.id === currentId)?.label ?? currentId;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="composer-model-select"
              aria-label={`Model: ${triggerLabel}`}
              className={[
                'flex items-center gap-1 px-2 py-1',
                'rounded-md text-label text-muted-foreground',
                'hover:bg-accent hover:text-accent-foreground',
                'transition-colors',
                'focus-visible:outline-none',
              ].join(' ')}
            >
              <span className="text-label font-medium">{triggerLabel}</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Switch model</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" side="top" sideOffset={6} className="min-w-48">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            data-testid={`composer-model-select-option-${option.id}`}
            onSelect={() => setModel(option.id)}
            className={option.id === currentId ? 'bg-accent text-accent-foreground font-medium' : ''}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
