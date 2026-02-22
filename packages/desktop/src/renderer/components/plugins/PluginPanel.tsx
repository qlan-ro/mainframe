import { Suspense } from 'react';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { usePluginComponent } from '../../hooks/usePluginComponent.js';
import { PluginError } from './PluginError.js';
import { buildPluginPanelAPI } from '../../lib/plugin-panel-api.js';

interface Props {
  pluginId: string;
  entryPoint: string;
}

export function PluginPanel({ pluginId, entryPoint }: Props) {
  const Component = usePluginComponent(entryPoint);
  const api = buildPluginPanelAPI(pluginId);

  return (
    <ErrorBoundary fallback={<PluginError pluginId={pluginId} />}>
      <Suspense fallback={<div className="p-4 text-mf-text-secondary text-sm">Loading plugin…</div>}>
        {Component ? <Component api={api} /> : null}
      </Suspense>
    </ErrorBoundary>
  );
}
