'use client';

/**
 * PermissionSelect — Shield-icon trigger + dropdown of execution modes.
 *
 * Interactive / Auto-Edits / Auto / Unattended, least to most permissive. Auto is
 * the Claude CLI's own mode and shows only for an adapter advertising
 * capabilities.autoMode; the label is still resolved off the unfiltered list so a
 * chat carrying a mode this adapter can't offer never renders the raw wire string.
 * Tone tints the trigger and the option label: Unattended destructive, Auto caution.
 * NOT disabled while the chat is running — can be changed for the next turn.
 *
 * A floating list of choices is a native DropdownMenu (ledger rule, 2026-08-05).
 * Open chrome is driven by React state, not `data-[state=open]:` — the Hint's
 * `TooltipTrigger asChild` overwrites the child's `data-state` with the tooltip's.
 */

import { useState } from 'react';
import { ChevronDown, Shield } from 'lucide-react';
import type { AdapterInfo, Chat, ExecutionMode, ProviderConfig } from '@qlan-ro/mainframe-types';
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
  /** Resolved adapter for this chat; gates the Auto option. Null/absent while the catalog loads. */
  adapter?: AdapterInfo | null;
}

type ModeTone = 'caution' | 'destructive' | undefined;

const PERMISSION_MODES: { id: ExecutionMode; label: string; description: string; tone?: ModeTone }[] = [
  { id: 'default', label: 'Interactive', description: 'Approve every action' },
  { id: 'acceptEdits', label: 'Auto-Edits', description: 'Edits auto-applied; commands ask' },
  { id: 'auto', label: 'Auto', description: 'Claude decides which actions need approval', tone: 'caution' },
  { id: 'yolo', label: 'Unattended', description: 'Runs without prompts', tone: 'destructive' },
];

const TONE_INK: Record<'caution' | 'destructive', string> = {
  caution: 'text-warning',
  destructive: 'text-destructive',
};

function toneInk(tone: ModeTone): string {
  return tone == null ? 'text-muted-foreground' : TONE_INK[tone];
}

export function PermissionSelect({ chat, setPermissionMode, providerDefaults, adapter }: PermissionSelectProps) {
  const [open, setOpen] = useState(false);
  const currentMode: ExecutionMode = chat.permissionMode ?? providerDefaults?.defaultMode ?? 'default';
  const current = PERMISSION_MODES.find((m) => m.id === currentMode);
  const currentLabel = current?.label ?? currentMode;
  const offered = PERMISSION_MODES.filter((m) => m.id !== 'auto' || adapter?.capabilities.autoMode === true);

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
              toneInk(current?.tone),
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
          {offered.map((mode) => (
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
                <span className={cn('font-medium', mode.tone != null && TONE_INK[mode.tone])}>{mode.label}</span>
                <span className="text-xs leading-snug text-muted-foreground">{mode.description}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
