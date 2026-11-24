'use client';

/**
 * The composer's permissions control: the mode by name (C6), or "Planning ·
 * then Auto-Edits" while plan mode is on (C1). NOT disabled while the chat is
 * running: a change applies to the next action.
 *
 * Tone is the only place Unattended shows (C13): `warning` ink on a tinted
 * chip. Auto is warning ink alone. Auto shows only for an adapter advertising
 * capabilities.autoMode; the label is still resolved off the full list so a
 * chat carrying a mode this adapter can't offer never renders the raw wire
 * string.
 */

import { useState } from 'react';
import { ChevronDown, ClipboardList, Shield } from 'lucide-react';
import type { AdapterInfo, Chat, ExecutionMode, ProviderConfig } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ComposerHint } from '../composer-card-context';
import { PERMISSION_MODES, permissionLabel, type ModeTone } from './permission-modes';
import { toolbarButton } from './toolbar-button';

export interface PermissionSelectProps {
  chat: Chat;
  setPermissionMode: (mode: ExecutionMode) => void;
  providerDefaults?: ProviderConfig;
  /** Resolved adapter for this chat; gates the Auto option. Null/absent while the catalog loads. */
  adapter?: AdapterInfo | null;
  className?: string;
}

export function currentPermission(chat: Chat, providerDefaults?: ProviderConfig): ExecutionMode {
  return chat.permissionMode ?? providerDefaults?.defaultMode ?? 'default';
}

const toneOf = (mode: ExecutionMode): ModeTone => PERMISSION_MODES.find((m) => m.id === mode)?.tone;

/** Trigger classes for a mode: warning ink for Auto, a tinted chip for Unattended, the accent while planning. */
export function permissionTone(mode: ExecutionMode, planning: boolean): string | undefined {
  if (planning) return 'text-accent-ink';
  const tone = toneOf(mode);
  if (tone == null) return undefined;
  return cn(
    'text-warning',
    tone === 'warning' && 'bg-warning/10 ring-1 ring-warning/40 ring-inset hover:bg-warning/20',
  );
}

/** "Interactive", or "Planning · then Auto-Edits". */
export function permissionStatus(mode: ExecutionMode, planning: boolean): string {
  return planning ? `Planning · then ${permissionLabel(mode)}` : permissionLabel(mode);
}

interface PermissionItemsProps {
  mode: ExecutionMode;
  planning: boolean;
  autoAllowed: boolean;
  onSelect: (mode: ExecutionMode) => void;
}

/** The mode list, shared by this menu and the combined chip's. */
export function PermissionItems({ mode, planning, autoAllowed, onSelect }: PermissionItemsProps) {
  const offered = PERMISSION_MODES.filter((m) => m.id !== 'auto' || autoAllowed);
  return (
    <DropdownMenuGroup>
      {planning && (
        <DropdownMenuLabel
          data-testid="composer-permission-planning-note"
          className="max-w-64 text-xs font-normal whitespace-normal"
        >
          Plan mode is active. Your choice applies once the plan is approved.
        </DropdownMenuLabel>
      )}
      <DropdownMenuRadioGroup value={mode} onValueChange={(next) => onSelect(next as ExecutionMode)}>
        {offered.map((m) => (
          <DropdownMenuRadioItem
            key={m.id}
            value={m.id}
            data-testid={`composer-permission-mode-select-option-${m.id}`}
            className="items-start"
          >
            <span className="flex min-w-0 flex-col">
              <span className={cn('font-medium', m.tone != null && 'text-warning')}>{m.label}</span>
              <span className="text-xs leading-snug text-muted-foreground">{m.description}</span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

export function PermissionSelect({
  chat,
  setPermissionMode,
  providerDefaults,
  adapter,
  className,
}: PermissionSelectProps) {
  const [open, setOpen] = useState(false);
  const mode = currentPermission(chat, providerDefaults);
  const planning = chat.planMode === true;
  const status = permissionStatus(mode, planning);
  const Icon = planning ? ClipboardList : Shield;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <ComposerHint label={`Permissions: ${status} · ⇧⇥ to switch`}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="composer-permission-mode-select"
            data-planning={planning || undefined}
            aria-label={`Permission mode: ${status}`}
            className={toolbarButton(open, cn('font-medium', permissionTone(mode, planning), className))}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">
              {planning ? 'Planning' : permissionLabel(mode)}
              {planning && <span className="font-normal text-muted-foreground"> · then {permissionLabel(mode)}</span>}
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-70" />
          </button>
        </DropdownMenuTrigger>
      </ComposerHint>
      <DropdownMenuContent align="start" side="top" sideOffset={6} className="w-64">
        <PermissionItems
          mode={mode}
          planning={planning}
          autoAllowed={adapter?.capabilities.autoMode === true}
          onSelect={setPermissionMode}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
