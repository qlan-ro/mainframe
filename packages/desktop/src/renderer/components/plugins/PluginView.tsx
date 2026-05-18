import React from 'react';
import type { UIZone } from '@qlan-ro/mainframe-types';
import { ErrorBoundary } from '../ErrorBoundary';
import { PluginError } from './PluginError';
import { TodosPanel } from '../todos/TodosPanel.js';
import { TodosSidebar } from '../todos/TodosSidebar.js';

// Registry of builtin plugin components keyed by (pluginId, zone).
// Lets one plugin contribute different UIs to different zones — the todos
// plugin shows the Kanban board in fullview and a condensed sidebar in the
// right-top zone. External plugins register dynamically at load time.
const BUILTIN_COMPONENTS: Record<string, Partial<Record<UIZone, React.ComponentType>>> = {
  todos: {
    fullview: TodosPanel,
    'right-top': TodosSidebar,
  },
};

/** Register a builtin plugin's React component for a specific zone. */
export function registerBuiltinComponent(pluginId: string, zone: UIZone, Component: React.ComponentType): void {
  const existing = BUILTIN_COMPONENTS[pluginId] ?? {};
  BUILTIN_COMPONENTS[pluginId] = { ...existing, [zone]: Component };
}

interface Props {
  pluginId: string;
  /** Which zone this instance is being rendered in. Defaults to 'fullview' for back-compat. */
  zone?: UIZone;
}

export function PluginView({ pluginId, zone = 'fullview' }: Props): React.ReactElement {
  const byZone = BUILTIN_COMPONENTS[pluginId];
  const Component = byZone?.[zone];

  if (!Component) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-small">
        Plugin &quot;{pluginId}&quot; has no component registered for zone &quot;{zone}&quot;.
      </div>
    );
  }

  return (
    <ErrorBoundary fallback={<PluginError pluginId={pluginId} />}>
      <Component />
    </ErrorBoundary>
  );
}
