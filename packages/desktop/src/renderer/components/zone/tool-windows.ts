import React from 'react';
import type { ComponentType } from 'react';
import type { ZoneId, ToolWindowManifest } from '@qlan-ro/mainframe-types';
import { MessageSquare, Wand2, Bot, FolderOpen, BookOpen, GitBranch, Eye, TerminalSquare } from 'lucide-react';
import { ChatsPanel } from '../panels/ChatsPanel';
import { SkillsPanel } from '../panels/SkillsPanel';
import { AgentsPanel } from '../panels/AgentsPanel';
import { FilesTab } from '../panels/FilesTab';
import { ContextTab } from '../panels/ContextTab';
import { ChangesTab } from '../panels/ChangesTab';
import { PreviewTab } from '../sandbox/PreviewTab';

const LazyTerminalPanel = React.lazy(() =>
  import('../terminal/TerminalPanel').then((m) => ({ default: m.TerminalPanel })),
);

export interface ToolWindowDef {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  component?: ComponentType;
  defaultZone: ZoneId;
  isBuiltin: boolean;
}

export const BUILTIN_TOOL_WINDOWS: ToolWindowDef[] = [
  {
    id: 'sessions',
    label: 'Sessions',
    icon: MessageSquare,
    component: ChatsPanel,
    defaultZone: 'left-top',
    isBuiltin: true,
  },
  { id: 'skills', label: 'Skills', icon: Wand2, component: SkillsPanel, defaultZone: 'left-bottom', isBuiltin: true },
  { id: 'agents', label: 'Agents', icon: Bot, component: AgentsPanel, defaultZone: 'left-bottom', isBuiltin: true },
  { id: 'files', label: 'Files', icon: FolderOpen, component: FilesTab, defaultZone: 'right-top', isBuiltin: true },
  {
    id: 'context',
    label: 'Context',
    icon: BookOpen,
    component: ContextTab,
    defaultZone: 'right-bottom',
    isBuiltin: true,
  },
  {
    id: 'changes',
    label: 'Changes',
    icon: GitBranch,
    component: ChangesTab,
    defaultZone: 'right-bottom',
    isBuiltin: true,
  },
  { id: 'preview', label: 'Preview', icon: Eye, component: PreviewTab, defaultZone: 'bottom-left', isBuiltin: true },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: TerminalSquare,
    component: LazyTerminalPanel,
    defaultZone: 'bottom-right',
    isBuiltin: true,
  },
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
