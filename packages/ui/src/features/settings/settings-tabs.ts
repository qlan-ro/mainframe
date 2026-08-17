import { SlidersHorizontal, Cpu, Keyboard, Bell, Globe, Info } from 'lucide-react';
import type React from 'react';
import type { ProviderConfig } from '@qlan-ro/mainframe-types';
import type { SettingsTab } from '../../store/settings';

export const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'providers', label: 'Providers', icon: Cpu },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'remote-access', label: 'Remote Access', icon: Globe },
  { id: 'about', label: 'About', icon: Info },
];

export const MODE_OPTIONS: {
  id: NonNullable<ProviderConfig['defaultMode']>;
  label: string;
  description: string;
  danger?: boolean;
  caution?: boolean;
}[] = [
  { id: 'default', label: 'Interactive', description: 'Prompts for everything' },
  {
    id: 'acceptEdits',
    label: 'Auto-Accept Edits',
    description: 'Silently applies file edits, still prompts for bash',
  },
  {
    id: 'auto',
    label: 'Auto',
    description: 'Claude decides which actions need approval',
    caution: true,
  },
  {
    id: 'yolo',
    label: 'Unattended',
    description: 'Auto-approves everything — use in isolated environments only',
    danger: true,
  },
];
