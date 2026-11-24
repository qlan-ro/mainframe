'use client';

/**
 * Below 400px the model and the permissions are one chip (C6): only the model
 * name truncates, and below 320px it goes, so the permission status always
 * shows.
 */

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProviderDot } from '@/features/shared/ProviderDot';
import { cn } from '@/lib/utils';
import { ComposerHint } from '../composer-card-context';
import { ModelMenu, activeModel, type ModelMenuProps } from './ModelMenu';
import { PermissionItems, currentPermission, permissionStatus, permissionTone } from './PermissionSelect';
import { permissionLabel } from './permission-modes';
import { MODEL_LOCKED_HINT } from './ProviderModelSelect';
import { toolbarButton } from './toolbar-button';

interface CombinedSelectProps extends ModelMenuProps {
  /** True while a turn is running: the model locks, the permissions don't. */
  disabled: boolean;
  setPermissionMode: (mode: ExecutionMode) => void;
  className?: string;
}

export function CombinedSelect({ disabled, setPermissionMode, className, ...menu }: CombinedSelectProps) {
  const [open, setOpen] = useState(false);
  const { activeId, modelLabel, effortLabel } = activeModel(menu);
  const mode = currentPermission(menu.chat, menu.providerDefaults);
  const planning = menu.chat.planMode === true;
  const status = permissionStatus(mode, planning);
  const summary = `${[modelLabel, effortLabel].filter(Boolean).join(' ')} · ${status}`;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <ComposerHint label={`${summary} · ⇧⇥ to switch permissions`}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="composer-model-permission-select"
            data-permissions-control
            aria-label={`Model and permissions: ${summary}`}
            className={toolbarButton(open, cn(permissionTone(mode, planning), 'text-foreground/90', className))}
          >
            <ProviderDot adapterId={activeId} className="@max-[320px]/composer:hidden" />
            <span className="flex min-w-0 items-baseline">
              <span className="min-w-0 truncate @max-[320px]/composer:hidden">{modelLabel}</span>
              <span className="shrink-0 text-muted-foreground @max-[320px]/composer:hidden">&nbsp;·&nbsp;</span>
              <span className={cn('shrink-0 font-medium', permissionTone(mode, planning), 'bg-transparent ring-0')}>
                {planning ? 'Planning' : permissionLabel(mode)}
              </span>
            </span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground @max-[320px]/composer:hidden" />
          </button>
        </DropdownMenuTrigger>
      </ComposerHint>
      <DropdownMenuContent align="start" side="top" sideOffset={6} className="w-72">
        {disabled ? (
          <DropdownMenuLabel className="text-xs font-normal">{MODEL_LOCKED_HINT}</DropdownMenuLabel>
        ) : (
          <ModelMenu {...menu} onClose={() => setOpen(false)} />
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Permissions</DropdownMenuLabel>
        <PermissionItems
          mode={mode}
          planning={planning}
          autoAllowed={menu.adapter?.capabilities.autoMode === true}
          onSelect={setPermissionMode}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
