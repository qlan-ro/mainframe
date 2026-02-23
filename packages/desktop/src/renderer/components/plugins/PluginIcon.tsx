import React from 'react';
import { SquareCheck, MessageSquare, type LucideProps } from 'lucide-react';

// Curated map of Lucide icon names plugins may declare.
// Add entries as new plugins are introduced.
const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  'square-check': SquareCheck,
  'message-square': MessageSquare,
};

interface PluginIconProps {
  name: string;
  size?: number;
}

export function PluginIcon({ name, size = 16 }: PluginIconProps): React.ReactElement | null {
  const Icon = ICON_MAP[name];
  return Icon ? <Icon size={size} /> : null;
}
