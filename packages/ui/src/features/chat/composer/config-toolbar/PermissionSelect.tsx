'use client';

/**
 * PermissionSelect — Shield-icon trigger + dropdown of execution modes.
 *
 * Fixed list: Interactive / Auto-Edits / Unattended (mirrors desktop PERMISSION_MODES).
 * When the selected mode is 'yolo', the trigger is tinted text-destructive.
 * NOT disabled while the chat is running — can be changed for the next turn.
 *
 * A floating list of choices is a native DropdownMenu (ledger rule, 2026-08-05).
 * Open chrome is driven by React state, not `data-[state=open]:` — the Hint's
 * `TooltipTrigger asChild` overwrites the child's `data-state` with the tooltip's.
 */

import { useState } from 'react';
import { ChevronDown, Shield } from 'lucide-react';
import type { Chat, ExecutionMode, ProviderConfig } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';

export interface PermissionSelectProps {
  chat: Chat;
  setPermissionMode: (mode: ExecutionMode) => void;
  providerDefaults?: ProviderConfig;
}

const PERMISSION_MODES: { id: ExecutionMode; label: string; description: string }[] = [
  { id: 'default', label: 'Interactive', description: 'Approve every action' },
  { id: 'acceptEdits', label: 'Auto-Edits', description: 'Edits auto-applied; commands ask' },
  { id: 'yolo', label: 'Unattended', description: 'Runs without prompts' },
];

export function PermissionSelect({ chat, setPermissionMode, providerDefaults }: PermissionSelectProps) {
  const [open, setOpen] = useState(false);
  const currentMode: ExecutionMode = chat.permissionMode ?? providerDefaults?.defaultMode ?? 'default';
  const isYolo = currentMode === 'yolo';
  const currentLabel = PERMISSION_MODES.find((m) => m.id === currentMode)?.label ?? currentMode;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Hint label={`Permission: ${currentLabel}`} side="top">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="composer-permission-mode-select"
            aria-label={`Permission mode: ${currentLabel}`}
            className={cn(
              'flex h-[20px] shrink-0 items-center justify-center gap-[5px] px-[6px]',
              '@[560px]:justify-start @[560px]:pl-[8px] @[560px]:pr-[7px]',
              'rounded-[11px] border-[0.5px] border-border text-xs',
              'hover:bg-accent hover:text-accent-foreground',
              open && 'border-primary bg-sidebar-selection',
              'transition-colors',
              'focus-visible:outline-none',
              isYolo ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            <Shield size={12} className="shrink-0" />
            <span className="hidden @[560px]:inline truncate font-medium">{currentLabel}</span>
            <ChevronDown size={12} className="hidden @[560px]:inline shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
      </Hint>

      <DropdownMenuContent align="start" side="top" sideOffset={6} className="min-w-40">
        <DropdownMenuGroup>
          {PERMISSION_MODES.map((mode) => (
            <DropdownMenuItem
              key={mode.id}
              data-testid={`composer-permission-mode-select-option-${mode.id}`}
              onSelect={() => setPermissionMode(mode.id)}
              className={cn(
                'items-start',
                mode.id === currentMode && 'bg-sidebar-selection font-medium text-foreground',
              )}
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{mode.label}</span>
                <span className="text-xs leading-snug text-muted-foreground">{mode.description}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
