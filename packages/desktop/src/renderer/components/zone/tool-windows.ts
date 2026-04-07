import type { ComponentType } from 'react';
import type { ZoneId, ToolWindowManifest } from '@qlan-ro/mainframe-types';

export interface ToolWindowDef {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  component?: ComponentType;
  defaultZone: ZoneId;
  isBuiltin: boolean;
}

export const BUILTIN_TOOL_WINDOWS: ToolWindowDef[] = [
  { id: 'sessions', label: 'Sessions', defaultZone: 'left-top', isBuiltin: true },
  { id: 'skills', label: 'Skills', defaultZone: 'left-bottom', isBuiltin: true },
  { id: 'agents', label: 'Agents', defaultZone: 'left-bottom', isBuiltin: true },
  { id: 'files', label: 'Files', defaultZone: 'right-top', isBuiltin: true },
  { id: 'context', label: 'Context', defaultZone: 'right-bottom', isBuiltin: true },
  { id: 'changes', label: 'Changes', defaultZone: 'right-bottom', isBuiltin: true },
  { id: 'preview', label: 'Preview', defaultZone: 'bottom-left', isBuiltin: true },
  { id: 'terminal', label: 'Terminal', defaultZone: 'bottom-right', isBuiltin: true },
];

const pluginToolWindows = new Map<string, ToolWindowDef>();

export function getAllToolWindows(): ToolWindowDef[] {
  return [...BUILTIN_TOOL_WINDOWS, ...pluginToolWindows.values()];
}

export function getToolWindow(id: string): ToolWindowDef | undefined {
  const builtin = BUILTIN_TOOL_WINDOWS.find((tw) => tw.id === id);
  if (builtin !== undefined) return builtin;
  return pluginToolWindows.get(id);
}

export function getToolWindowsForZone(zone: ZoneId): ToolWindowDef[] {
  return getAllToolWindows().filter((tw) => tw.defaultZone === zone);
}

export function registerPluginToolWindow(manifest: ToolWindowManifest): void {
  const def: ToolWindowDef = {
    id: manifest.id,
    label: manifest.label,
    icon: undefined,
    component: undefined,
    defaultZone: manifest.defaultZone,
    isBuiltin: false,
  };
  pluginToolWindows.set(manifest.id, def);
}

export function unregisterPluginToolWindow(id: string): void {
  const isBuiltin = BUILTIN_TOOL_WINDOWS.some((tw) => tw.id === id);
  if (isBuiltin) return;
  pluginToolWindows.delete(id);
}
