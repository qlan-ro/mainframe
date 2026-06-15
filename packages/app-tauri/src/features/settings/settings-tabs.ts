import { SlidersHorizontal, Cpu, Bell, Globe, Info } from 'lucide-react';
import type React from 'react';
import type { ProviderConfig } from '@qlan-ro/mainframe-types';
import type { SettingsTab } from '../../store/settings';

// No 'keybindings' tab — S4 drops the placeholder pane.
export const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'providers', label: 'Providers', icon: Cpu },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'remote-access', label: 'Remote Access', icon: Globe },
  { id: 'about', label: 'About', icon: Info },
];

export const MODE_OPTIONS: {
  id: NonNullable<ProviderConfig['defaultMode']>;
  label: string;
  description: string;
  danger?: boolean;
}[] = [
  { id: 'default', label: 'Interactive', description: 'Prompts for everything' },
  {
    id: 'acceptEdits',
    label: 'Auto-Accept Edits',
    description: 'Silently applies file edits, still prompts for bash',
  },
  {
    id: 'yolo',
    label: 'Unattended',
    description: 'Auto-approves everything — use in isolated environments only',
    danger: true,
  },
];
