import { useEffect, useState } from 'react';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../../../../store/settings';
import { getAdapters } from '../../../../lib/api/adapters';
import { ProviderConfigForm } from './ProviderConfigForm';

interface ProvidersPaneProps {
  port: number;
}

/** Reads `selectedProvider` from the store, fetches the adapter list from the daemon,
 *  finds the matching AdapterInfo, and renders the form. */
export function ProvidersPane({ port }: ProvidersPaneProps) {
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);

  useEffect(() => {
    getAdapters(port)
      .then(setAdapters)
      .catch((err: unknown) => console.warn('[settings/ProvidersPane] failed to load adapters', err));
  }, [port]);

  const adapter = adapters.find((a) => a.id === selectedProvider);

  return (
    <div data-testid="settings-pane-providers" className="flex flex-col gap-4 p-4">
      {!selectedProvider && (
        <p className="text-sm text-mf-text-secondary">Select a provider from the sidebar to configure it.</p>
      )}
      {selectedProvider && !adapter && adapters.length > 0 && (
        <p className="text-sm text-mf-text-secondary">Provider &ldquo;{selectedProvider}&rdquo; not found.</p>
      )}
      {selectedProvider && adapter && (
        <>
          <h3 className="text-sm font-medium text-mf-text-primary">{adapter.name}</h3>
          <ProviderConfigForm port={port} adapterId={selectedProvider} label={adapter.name} adapter={adapter} />
        </>
      )}
    </div>
  );
}
