import React from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { PluginError } from './PluginError';
import { TodosPanel } from '../todos/TodosPanel.js';

// Registry of builtin plugin components.
// External plugins will be dynamically imported and registered here at load time (future).
const BUILTIN_COMPONENTS: Record<string, React.ComponentType> = {
  todos: TodosPanel,
};

/** Register a builtin plugin's React component. Call before the component is first rendered. */
export function registerBuiltinComponent(pluginId: string, Component: React.ComponentType): void {
  BUILTIN_COMPONENTS[pluginId] = Component;
}

interface Props {
  pluginId: string;
}

export function PluginView({ pluginId }: Props): React.ReactElement {
  const Component = BUILTIN_COMPONENTS[pluginId];

  if (!Component) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-small">
        Plugin &quot;{pluginId}&quot; is not registered.
      </div>
    );
  }

  return (
    <ErrorBoundary fallback={<PluginError pluginId={pluginId} />}>
      <Component />
    </ErrorBoundary>
  );
}
