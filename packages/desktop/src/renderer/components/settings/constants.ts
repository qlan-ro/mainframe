import type { SettingsTab } from '../../store/settings';
import type { ProviderConfig } from '@mainframe/types';
import { SlidersHorizontal, Keyboard, Info, Cpu } from 'lucide-react';
import type React from 'react';

export const MODE_OPTIONS: {
  id: ProviderConfig['defaultMode'];
  label: string;
  description: string;
  danger?: boolean;
}[] = [
  { id: 'default', label: 'Interactive', description: 'Prompts for everything' },
  { id: 'acceptEdits', label: 'Auto-Accept Edits', description: 'Silently applies file edits, still prompts for bash' },
  {
    id: 'yolo',
    label: 'Unattended',
    description: 'Auto-approves everything — use in isolated environments only',
    danger: true,
  },
  { id: 'plan', label: 'Plan Mode', description: 'Research only until plan is approved' },
];

export const EXECUTION_MODE_OPTIONS: {
  id: NonNullable<ProviderConfig['planExecutionMode']>;
  label: string;
  description: string;
}[] = [
  { id: 'default', label: 'Interactive', description: 'Prompts for everything after plan approval' },
  { id: 'acceptEdits', label: 'Auto-Accept Edits', description: 'Auto-approves file edits, prompts for bash' },
  {
    id: 'yolo',
    label: 'Skip All Permissions',
    description: 'Auto-approves everything — use in isolated environments only',
  },
];

export const SIDEBAR_TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'providers', label: 'Providers', icon: Cpu },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info },
];

export const PROVIDER_COLORS: Record<string, string> = {
  claude: 'bg-mf-accent-claude',
  codex: 'bg-mf-accent-codex',
  gemini: 'bg-mf-accent-gemini',
  opencode: 'bg-mf-accent-opencode',
};

export const PROVIDER_BORDER_COLORS: Record<string, string> = {
  claude: 'border-mf-accent-claude',
  codex: 'border-mf-accent-codex',
  gemini: 'border-mf-accent-gemini',
  opencode: 'border-mf-accent-opencode',
};
