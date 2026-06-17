'use client';

/**
 * PermissionSelect — Shield-icon trigger + dropdown of execution modes.
 *
 * Fixed list: Interactive / Auto-Edits / Unattended (mirrors desktop PERMISSION_MODES).
 * When the selected mode is 'yolo', the trigger is tinted text-destructive.
 * NOT disabled while the chat is running — can be changed for the next turn.
 *
 * Built on shadcn DropdownMenu; never raw Radix.
 * Token rule: no /opacity modifier on hex CSS-var colors.
 * --destructive is hex, so text-destructive is used as a Tailwind utility
 * (mapped in @theme inline), not a /opacity variant.
 */

import { Shield } from 'lucide-react';
import type { Chat, ExecutionMode } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface PermissionSelectProps {
  chat: Chat;
  setPermissionMode: (mode: ExecutionMode) => void;
}

const PERMISSION_MODES: { id: ExecutionMode; label: string; description: string }[] = [
  { id: 'default', label: 'Interactive', description: 'Approve every action' },
  { id: 'acceptEdits', label: 'Auto-Edits', description: 'Edits auto-applied; commands ask' },
  { id: 'yolo', label: 'Unattended', description: 'Runs without prompts' },
];

export function PermissionSelect({ chat, setPermissionMode }: PermissionSelectProps) {
  const currentMode: ExecutionMode = chat.permissionMode ?? 'default';
  const isYolo = currentMode === 'yolo';
  const currentLabel = PERMISSION_MODES.find((m) => m.id === currentMode)?.label ?? currentMode;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="composer-permission-mode-select"
              aria-label={`Permission mode: ${currentLabel}`}
              className={[
                'flex h-[20px] items-center gap-[5px] pl-[8px] pr-[7px]',
                'rounded-[11px] border-[0.5px] border-border text-caption',
                'hover:bg-accent hover:text-accent-foreground',
                'data-[state=open]:border-primary data-[state=open]:bg-mf-selection',
                'transition-colors',
                'focus-visible:outline-none',
                isYolo ? 'text-destructive' : 'text-muted-foreground',
              ].join(' ')}
            >
              <Shield size={14} className="shrink-0" />
              <span className="text-caption font-medium">{currentLabel}</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Execution permission mode</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" side="top" sideOffset={6} className="min-w-40">
        {PERMISSION_MODES.map((mode) => (
          <DropdownMenuItem
            key={mode.id}
            data-testid={`composer-permission-mode-select-option-${mode.id}`}
            onSelect={() => setPermissionMode(mode.id)}
            className={mode.id === currentMode ? 'bg-accent text-accent-foreground font-medium' : ''}
          >
            <div className="flex flex-col">
              <span className="text-label font-medium">{mode.label}</span>
              <span className="text-caption text-muted-foreground">{mode.description}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
