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

const PERMISSION_MODES: { id: ExecutionMode; label: string }[] = [
  { id: 'default', label: 'Interactive' },
  { id: 'acceptEdits', label: 'Auto-Edits' },
  { id: 'yolo', label: 'Unattended' },
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
                'flex items-center gap-1 px-2 py-1',
                'rounded-md text-label',
                'hover:bg-accent hover:text-accent-foreground',
                'transition-colors',
                'focus-visible:outline-none',
                isYolo ? 'text-destructive' : 'text-muted-foreground',
              ].join(' ')}
            >
              <Shield size={14} className="shrink-0" />
              <span className="text-label font-medium">{currentLabel}</span>
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
            {mode.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
